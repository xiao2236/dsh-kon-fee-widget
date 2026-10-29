/**
 * dsh-kon-fee-widget — Web 客户端源码。
 *
 * 挂件就是原版的大茶桌（desk00 背景 + 五人坐姿 + desk01 前景三层切分），
 * 默认五个人全坐满；平时不显示余额，点一下才弹出账本：余额 + 峰谷 + 更新时间。
 */
;(() => {
	window.__ModuleLoader__.load({
		id: "dsh-kon-fee-widget",
		factory: (require) => {
			const React = require("react");
			const { useCallback, useEffect, useRef, useState } = React;
			const h = React.createElement;
			const Core = globalThis.KonFeeCore;
			if (!Core) throw new Error("dsh-kon-fee-widget: 缺少 KonFeeCore，请先运行 node scripts/build-client.mjs");

			const ASSET_BASE = "/dsh-kon-fee-widget";
			const ASSET_REV = "__FEE_ASSET_REV__";
			const TABLE = Core.TABLE;
			const SNAP_DISTANCE = 24;
			const PANEL_MS = 8000;

			// ---------------- 配置（宿主下发；设置页管「谁坐上桌」） ----------------
			const DEFAULT_CONFIG = {
				visible: true,
				characters: { mio: true, ritsu: true, yui: true, tsumugi: true, azusa: true },
				scale: 1,
				snap: true,
				refreshSeconds: 60,
				warnBelow: 5,
				turnBubble: true,
				panelDurationMs: 8000,
			};
			const POS_KEY = "dsh-kon-fee:pos";
			const configListeners = new Set();
			let currentConfig = null;
			let configPath = "";
			let configLoaded = false;

			function readPos() {
				try {
					const raw = localStorage.getItem(POS_KEY);
					const parsed = raw ? JSON.parse(raw) : null;
					return parsed && Number.isFinite(Number(parsed.x)) && Number.isFinite(Number(parsed.y))
						? { x: Math.round(Number(parsed.x)), y: Math.round(Number(parsed.y)) }
						: null;
				} catch {
					return null;
				}
			}

			function writePos(pos) {
				try {
					localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
				} catch {
					/* 隐私模式下不可写 */
				}
			}

			function getConfig() {
				return currentConfig || DEFAULT_CONFIG;
			}

			function setConfig(patch, path) {
				currentConfig = { ...getConfig(), ...(patch && typeof patch === "object" ? patch : {}) };
				if (typeof path === "string" && path) configPath = path;
				for (const listener of configListeners) {
					try { listener(); } catch { /* 单个订阅失败不影响别人 */ }
				}
			}

			async function loadConfig() {
				if (configLoaded) return;
				configLoaded = true;
				try {
					const response = await fetch(`${ASSET_BASE}/config`, { cache: "no-store" });
					const body = response.ok ? await response.json() : null;
					if (body && body.config) setConfig(body.config, body.path);
				} catch {
					/* 宿主不给就只用默认配置 */
				}
			}

			async function updateConfig(patch) {
				setConfig(patch);
				try {
					const response = await fetch(`${ASSET_BASE}/config`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch),
					});
					const body = response.ok ? await response.json() : null;
					if (body && body.config) setConfig(body.config, body.path);
				} catch {
					/* 写失败时页面上已经生效，下次刷新回退 */
				}
			}

			function useConfig() {
				const [, force] = useState(0);
				useEffect(() => {
					const listener = () => force((value) => value + 1);
					configListeners.add(listener);
					loadConfig();
					return () => configListeners.delete(listener);
				}, []);
				return getConfig();
			}

			// ---------------- 样式 ----------------
			const CSS = `
.konfee-root{position:fixed;inset:0;z-index:2147481900;pointer-events:none;font-family:inherit}
.konfee-table{position:absolute;left:0;top:0;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;will-change:transform;filter:drop-shadow(0 10px 18px rgba(40,30,55,.22))}
.konfee-table.is-drag{cursor:grabbing}
.konfee-stage{position:absolute;inset:0;transform-origin:50% 100%;transition:transform .16s cubic-bezier(.2,1.6,.4,1)}
.konfee-table.is-press .konfee-stage{transform:scale(.965)}
.konfee-back,.konfee-front{position:absolute;left:0;top:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none}
.konfee-back{z-index:0}
.konfee-front{z-index:3}
.konfee-seat{position:absolute;z-index:1;pointer-events:none}
.konfee-seat canvas{width:100%;height:100%;image-rendering:pixelated;display:block}
.konfee-panel{position:fixed;transform:translate(-50%,-100%);width:238px;box-sizing:border-box;padding:11px 14px 10px;border-radius:16px;background:linear-gradient(180deg,#fffdf8 0%,#fdf6e9 100%);color:#4a3d33;border:1px solid rgba(163,131,94,.34);box-shadow:0 16px 36px rgba(76,52,28,.24),0 2px 7px rgba(76,52,28,.12),inset 0 1px 0 rgba(255,255,255,.9);pointer-events:none;z-index:2147481910;animation:konfee-pop .2s cubic-bezier(.2,1.5,.45,1)}
.konfee-panel.is-below{transform:translate(-50%,0)}
.konfee-panel:after{content:"";position:absolute;left:50%;top:100%;width:9px;height:9px;margin-left:-5px;margin-top:-5px;background:#fdf6e9;border-right:1px solid rgba(163,131,94,.34);border-bottom:1px solid rgba(163,131,94,.34);transform:rotate(45deg)}
.konfee-panel.is-below:after{top:-5px;margin-top:0;transform:rotate(-135deg)}
@keyframes konfee-pop{from{opacity:0;transform:translate(-50%,-100%) translateY(5px) scale(.96)}to{opacity:1;transform:translate(-50%,-100%) translateY(0) scale(1)}}
.konfee-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.konfee-title{font-size:10px;letter-spacing:.16em;color:#ab8a68;font-weight:600;white-space:nowrap}
.konfee-amount-row{display:flex;align-items:baseline;gap:3px;margin:5px 0 8px}
.konfee-currency{font-size:13px;color:#8d7256;font-weight:600;transform:translateY(-1px)}
.konfee-amount{font-size:27px;line-height:1;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.konfee-amount.tone-warn{color:#c4563f}
.konfee-amount.tone-error{color:#a0836a;font-size:15px;font-weight:600;transform:translateY(-2px)}
.konfee-meter{margin:0}
.konfee-today{margin:0 0 6px;font-size:11px;color:#8a6a4a;font-variant-numeric:tabular-nums}
.konfee-today-tokens{opacity:.6}
.konfee-schedule{margin:0 0 6px;font-size:10px;color:#a4886b;line-height:1.5}
.konfee-schedule-note{opacity:.7}
.konfee-track{height:5px;border-radius:999px;background:rgba(166,133,96,.18);overflow:hidden}
.konfee-track i{display:block;height:100%;border-radius:999px;transition:width .6s ease}
.konfee-track i.is-peak{background:linear-gradient(90deg,#eaa78f,#d0604a)}
.konfee-track i.is-valley{background:linear-gradient(90deg,#a9cfae,#5f9a6d)}
.konfee-meter-text{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10.5px;color:#9b7f61;font-variant-numeric:tabular-nums}
.konfee-divider{height:1px;margin:9px 0 8px;background:repeating-linear-gradient(90deg,rgba(163,131,94,.35) 0 4px,transparent 4px 8px)}
.konfee-tag{flex:none;font-size:10px;padding:1.5px 7px;border-radius:999px;border:1px solid transparent;font-weight:600;letter-spacing:.03em}
.konfee-tag.is-peak{color:#b3503f;background:rgba(214,88,88,.13);border-color:rgba(214,88,88,.34)}
.konfee-tag.is-valley{color:#4d7a5c;background:rgba(95,138,106,.15);border-color:rgba(95,138,106,.34)}
.konfee-line{font-size:11px;line-height:1.55;color:#7c6752}
.konfee-foot{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:9.5px;color:#a4886b}
.konfee-status{font-size:9.5px;color:#a4886b}
.konfee-status.tone-error{color:#c4563f}
.konfee-spend{position:fixed;transform:translate(-50%,-100%);display:flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;background:rgba(56,44,32,.93);color:#fff6e7;font-size:11px;box-shadow:0 10px 22px rgba(40,28,16,.28);pointer-events:none;z-index:2147481912;white-space:nowrap;animation:konfee-spend-in .22s cubic-bezier(.2,1.4,.4,1)}
.konfee-spend b{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.konfee-spend span{opacity:.72;font-variant-numeric:tabular-nums}
.konfee-spend .konfee-spend-tag{opacity:1;font-size:9.5px;padding:1.5px 6px;border-radius:999px;background:rgba(255,255,255,.15)}
.konfee-spend.is-below{transform:translate(-50%,0)}
@keyframes konfee-spend-in{from{opacity:0;transform:translate(-50%,-100%) translateY(4px)}to{opacity:1;transform:translate(-50%,-100%) translateY(0)}}
.konfee-set{padding:2px 0 26px;font-size:13px;line-height:1.6;color:inherit}
.konfee-set h2{font-size:18px;font-weight:650;margin:0 0 4px}
.konfee-set-sub{font-size:12px;opacity:.6;margin:0 0 16px}
.konfee-set-card{border:1px solid rgba(127,127,127,.2);border-radius:14px;padding:6px 16px;margin:0 0 14px;background:rgba(127,127,127,.035)}
.konfee-set-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid rgba(127,127,127,.12)}
.konfee-set-row:first-child{border-top:0}
.konfee-set-name{flex:1;min-width:0}
.konfee-set-name b{display:block;font-size:13px;font-weight:600}
.konfee-set-label{flex:1;min-width:0;font-size:13px;font-weight:600}
.konfee-set-name small{display:block;font-size:11px;opacity:.55}
.konfee-range{width:150px;flex:none;accent-color:#8a6aa8}
.konfee-value{width:64px;text-align:right;font-size:12px;opacity:.6;flex:none;font-variant-numeric:tabular-nums}
.konfee-btn{border:1px solid rgba(127,127,127,.25);background:transparent;border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;color:inherit}
.konfee-btn:hover{background:rgba(127,127,127,.08)}
.konfee-btn.is-on{border-color:rgba(127,127,127,.6);background:rgba(127,127,127,.1)}
.konfee-btn:disabled{opacity:.45;cursor:default}
.konfee-note{font-size:11px;line-height:1.7;opacity:.55;margin:10px 0 0}
.konfee-switch{position:relative;width:36px;height:20px;flex:none;border:0;border-radius:999px;background:rgba(127,127,127,.3);cursor:pointer;padding:0;transition:background .15s}
.konfee-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.konfee-switch.is-on{background:#7c5aa6}
.konfee-switch.is-on i{transform:translateX(16px)}
.konfee-switch:disabled{opacity:.45;cursor:default}
.konfee-chars{display:flex;flex-wrap:wrap;gap:6px}
.konfee-path{font-size:10.5px;color:#8a7a6a;background:rgba(127,127,127,.08);padding:3px 7px;border-radius:6px;word-break:break-all;max-width:48%;text-align:right}
.konfee-btn.is-primary{background:#7c5aa6;border-color:#7c5aa6;color:#fff}
.konfee-btn.is-primary:hover{background:#6c4c94}
.konfee-modal{position:fixed;inset:0;z-index:2147481920;display:flex;align-items:center;justify-content:center;background:rgba(24,18,12,.42)}
.konfee-modal-card{width:min(560px,86vw);max-height:82vh;display:flex;flex-direction:column;gap:10px;background:#fffdf8;border:1px solid rgba(163,131,94,.34);border-radius:16px;box-shadow:0 24px 60px rgba(40,28,16,.35);padding:16px 18px}
.konfee-modal-title{font-size:14px;font-weight:650;color:#4a3d33}
.konfee-modal-sub{font-size:11px;color:#9b7f61;line-height:1.6}
.konfee-json{width:100%;box-sizing:border-box;flex:1;min-height:260px;resize:vertical;font:12px/1.55 ui-monospace,Consolas,monospace;color:#4a3d33;background:#fffaf0;border:1px solid rgba(163,131,94,.3);border-radius:10px;padding:10px 12px;outline:none}
.konfee-json:focus{border-color:rgba(163,131,94,.7);box-shadow:0 0 0 3px rgba(163,131,94,.15)}
.konfee-modal-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.konfee-modal-error{font-size:11px;color:#c4563f}
`;

			function styleElement() {
				return h("style", { "data-konfee-style": "inline", dangerouslySetInnerHTML: { __html: CSS } });
			}

			/** 1.2k tokens 这种紧凑写法。 */
			function formatTokens(tokens) {
				const value = Number(tokens) || 0;
				return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
			}

			// ---------------- 余额 ----------------
			const EMPTY_BALANCE = {
				loading: true,
				ok: false,
				amount: 0,
				currency: "",
				updatedAt: 0,
				error: "",
				configMissing: false,
				stale: false,
			};

			function useBalance(config) {
				const [state, setState] = useState(EMPTY_BALANCE);
				const alive = useRef(true);

				const refresh = useCallback(async () => {
					try {
						const response = await fetch(`${ASSET_BASE}/balance?ts=${Date.now()}`, { cache: "no-store" });
						const body = response.ok ? await response.json() : { ok: false, error: `http-${response.status}` };
						if (!alive.current) return;
						if (body && body.ok) {
							setState({
								loading: false,
								ok: true,
								amount: Number(body.amount) || 0,
								currency: body.currency || "",
								updatedAt: Number(body.at) || Date.now(),
								error: "",
								configMissing: false,
								stale: Boolean(body.stale),
							});
							return;
						}
						setState((previous) => ({
							loading: false,
							ok: false,
							amount: Number(body.amount) || previous.amount,
							currency: body.currency || previous.currency,
							updatedAt: Number(body.at) || previous.updatedAt,
							error: (body && body.error) || "request-failed",
							configMissing: Boolean(body && body.error === "no-key"),
							stale: Boolean(body && body.stale),
						}));
					} catch {
						if (!alive.current) return;
						setState((previous) => ({ ...previous, loading: false, ok: false, error: "network", stale: previous.updatedAt > 0 }));
					}
				}, []);

				useEffect(() => {
					alive.current = true;
					refresh();
					const interval = Math.max(10, Number(config.refreshSeconds) || 60) * 1000;
					const timer = window.setInterval(refresh, interval);
					return () => {
						alive.current = false;
						window.clearInterval(timer);
					};
				}, [refresh, config.refreshSeconds]);

				return { ...state, refresh };
			}

			/** 轮询宿主记的「上一轮消耗」和「今天合计」；只有出现新的 at 才算新的一轮。 */
			function useTurnCost(config) {
				const [turn, setTurn] = useState(null);
				const [today, setToday] = useState(null);
				const seen = useRef(0);
				const primed = useRef(false);
				useEffect(() => {
					if (!config.turnBubble) return undefined;
					let alive = true;
					const poll = async () => {
						try {
							const response = await fetch(`${ASSET_BASE}/last-turn?ts=${Date.now()}`, { cache: "no-store" });
							const body = response.ok ? await response.json() : null;
							if (!alive || !body) return;
							if (body.today) setToday(body.today);
							const at = body.turn ? Number(body.turn.at) || 0 : 0;
							if (!primed.current) {
								// 第一次只记住基线（包括"还没有记录"=0），不把旧结果弹出来
								primed.current = true;
								seen.current = at;
								return;
							}
							if (!at || at <= seen.current) return;
							seen.current = at;
							setTurn({ ...body.turn, at });
						} catch {
							/* 宿主没有这个路由时静默 */
						}
					};
					poll();
					const timer = window.setInterval(poll, 5000);
					return () => {
						alive = false;
						window.clearInterval(timer);
					};
				}, [config.turnBubble]);
				return { turn, today };
			}

			// ---------------- 茶桌素材 ----------------
			const imageCache = new Map();

			function loadImage(src) {
				if (imageCache.has(src)) return imageCache.get(src);
				const image = new Image();
				const promise = new Promise((resolve, reject) => {
					image.onload = () => resolve(image);
					image.onerror = () => reject(new Error(`加载失败：${src}`));
					image.src = src;
				});
				imageCache.set(src, promise);
				return promise;
			}

			function useTableAssets() {
				const [assets, setAssets] = useState(null);
				useEffect(() => {
					let live = true;
					(async () => {
						try {
							const [desk00, desk01, ...seats] = await Promise.all([
								loadImage(`${ASSET_BASE}/table/desk00.png?v=${ASSET_REV}`),
								loadImage(`${ASSET_BASE}/table/desk01.png?v=${ASSET_REV}`),
								...TABLE.seats.map((seat) => loadImage(`${ASSET_BASE}/table/${Core.ANIM[seat.id] ? `${seat.id}-frames` : seat.id}.png?v=${ASSET_REV}`)),
							]);
							if (!live) return;
							const seatImages = {};
							TABLE.seats.forEach((seat, index) => { seatImages[seat.id] = seats[index]; });
							setAssets({ desk00, desk01, seats: seatImages });
						} catch {
							/* 素材失败就只剩空舞台，不影响点开账本 */
						}
					})();
					return () => { live = false; };
				}, []);
				return assets;
			}

			/** 桌面背景：desk00 是 4 帧横向动画，按座位段抽切后拼起来。 */
			function TableBack({ image, frame }) {
				const ref = useRef(null);
				useEffect(() => {
					const canvas = ref.current;
					if (!canvas || !image) return undefined;
					const context = canvas.getContext("2d");
					const frames = Math.max(1, Math.floor(image.naturalWidth / TABLE.width));
					let raf = 0;
					let acc = 0;
					let last = performance.now();
					let tickFrame = 0;
					const draw = () => {
						context.clearRect(0, 0, frame.width, TABLE.height);
						for (const segment of frame.segments) {
							context.drawImage(
								image,
								(tickFrame % frames) * TABLE.width + segment.from, 0, segment.width, TABLE.height,
								segment.from - segment.offset + frame.offset, 0, segment.width, TABLE.height,
							);
						}
					};
					const tick = (now) => {
						acc += now - last;
						last = now;
						const interval = 1000 / Math.max(1, TABLE.fps);
						if (acc >= interval) {
							acc %= interval;
							tickFrame += 1;
							draw();
						}
						raf = requestAnimationFrame(tick);
					};
					draw();
					raf = requestAnimationFrame(tick);
					return () => cancelAnimationFrame(raf);
				}, [image, frame]);
				return h("canvas", { ref, width: frame.width, height: TABLE.height, className: "konfee-back", "aria-hidden": "true" });
			}

			/** 前景：desk01 盖在人物前面，同样按座位段抽切。 */
			function TableFront({ image, frame }) {
				const ref = useRef(null);
				useEffect(() => {
					const canvas = ref.current;
					if (!canvas || !image) return;
					const context = canvas.getContext("2d");
					context.clearRect(0, 0, frame.width, TABLE.height);
					for (const segment of frame.segments) {
						context.drawImage(
							image,
							segment.from, 0, segment.width, TABLE.height,
							segment.from - segment.offset + frame.offset, 0, segment.width, TABLE.height,
						);
					}
				}, [image, frame]);
				return h("canvas", { ref, width: frame.width, height: TABLE.height, className: "konfee-front", "aria-hidden": "true" });
			}

			/** 座位立绘：中间三人循环播放坐姿动画，两侧静态。 */
			function SeatSprite({ id, image }) {
				const ref = useRef(null);
				const willAnimate = Boolean(Core.ANIM[id]);
				useEffect(() => {
					const canvas = ref.current;
					if (!canvas || !image) return undefined;
					const context = canvas.getContext("2d");
					const width = TABLE.widths[id] || TABLE.charWidth;
					const frames = Core.ANIM[id] || [0];
					let raf = 0;
					let acc = 0;
					let last = performance.now();
					let frame = 0;
					const draw = () => {
						const index = frames[frame % frames.length];
						const sx = (index % Core.FRAME.columns) * width;
						const sy = Math.floor(index / Core.FRAME.columns) * TABLE.charHeight;
						context.clearRect(0, 0, width, TABLE.charHeight);
						context.drawImage(image, sx, sy, width, TABLE.charHeight, 0, 0, width, TABLE.charHeight);
					};
					const tick = (now) => {
						acc += now - last;
						last = now;
						const interval = 1000 / Math.max(1, TABLE.fps);
						if (acc >= interval) {
							acc %= interval;
							frame += 1;
							draw();
						}
						raf = requestAnimationFrame(tick);
					};
					draw();
					if (willAnimate) raf = requestAnimationFrame(tick);
					return () => { if (raf) cancelAnimationFrame(raf); };
				}, [id, image, willAnimate]);
				return h("canvas", { ref, width: TABLE.widths[id] || TABLE.charWidth, height: TABLE.charHeight, "aria-hidden": "true" });
			}

			// ---------------- 挂件 ----------------
			function FeeWidget() {
				const config = useConfig();
				const balance = useBalance(config);
				const { turn, today } = useTurnCost(config);
				const assets = useTableAssets();
				// 谁坐桌上就切出哪几段；一个都不选时保留整张空桌
				const visibleIds = Core.ROSTER.filter((member) => config.characters[member.id]).map((member) => member.id);
				const layout = Core.layoutSegments(visibleIds.length ? visibleIds : null);
				const showSeats = visibleIds.length > 0;
				// 人物立绘比座位段宽，盒子按「桌子 ∪ 人」算，免得贴边时人被视口裁掉。
				const frame = Core.frameBounds(layout);
				const size = {
					width: Math.round(frame.width * config.scale),
					height: Math.round(TABLE.height * config.scale),
				};
				const [pos, setPos] = useState(() => readPos() || Core.defaultPosition(size, { width: window.innerWidth, height: window.innerHeight }));
				const [pressing, setPressing] = useState(false);
				const [dragging, setDragging] = useState(false);
				const [open, setOpen] = useState(false);
				const [now, setNow] = useState(() => Date.now());
				const [spend, setSpend] = useState(null);
				const dragRef = useRef(null);
				const panelTimer = useRef(0);

				// 新一轮结算 → 弹一条小气泡
				useEffect(() => {
					if (!turn) return undefined;
					setSpend(turn);
					const timer = window.setTimeout(() => setSpend(null), 6000);
					return () => window.clearTimeout(timer);
				}, [turn]);

				useEffect(() => {
					const onResize = () => {
						setPos((previous) => {
							const next = Core.snapToEdge(previous, size, { width: window.innerWidth, height: window.innerHeight }, { enabled: config.snap, threshold: SNAP_DISTANCE });
							return { x: next.x, y: next.y };
						});
					};
					window.addEventListener("resize", onResize);
					return () => window.removeEventListener("resize", onResize);
				}, [config.snap, size.width, size.height]);

				// 大小/人物显隐变化后把位置重新夹回可视范围
				useEffect(() => {
					setPos((previous) => {
						const next = Core.snapToEdge(previous, size, { width: window.innerWidth, height: window.innerHeight }, { enabled: config.snap, threshold: SNAP_DISTANCE });
						return { x: next.x, y: next.y };
					});
				}, [frame.width, config.scale, visibleIds.join(",")]);

				// 账本开着的时候每分钟刷新一次峰谷状态
				useEffect(() => {
					if (!open) return undefined;
					const timer = window.setInterval(() => setNow(Date.now()), 1000);
					return () => window.clearInterval(timer);
				}, [open]);

				useEffect(() => () => window.clearTimeout(panelTimer.current), []);

				const showPanel = useCallback(() => {
					setOpen(true);
					setNow(Date.now());
					window.clearTimeout(panelTimer.current);
					panelTimer.current = window.setTimeout(() => setOpen(false), config.panelDurationMs || PANEL_MS);
				}, []);

				const hidePanel = useCallback(() => {
					setOpen(false);
					window.clearTimeout(panelTimer.current);
				}, []);

				if (!config.visible) return null;
				// 一个人都没选：整张桌子也不显示
				if (!showSeats) return null;

				const peak = Core.priceWindow(now);
				const status = Core.statusInfo(balance);
				const warn = Boolean(balance.ok && balance.amount <= config.warnBelow);
				const tone = warn ? "warn" : balance.ok || balance.stale ? "ok" : "error";
				const amountText = balance.ok || balance.stale
					? Core.formatMoney(balance.amount, balance.currency)
					: balance.configMissing ? "未配置" : balance.error ? "读取失败" : "…";
				// 把「¥」和数字拆开，金额排版更干净
				const moneyMatch = amountText.match(/^([^\d]*)([\d.,]+.*)$/);
				const moneyParts = moneyMatch ? [moneyMatch[1], moneyMatch[2]] : ["", amountText];
				const line = balance.configMissing || (!balance.ok && !balance.stale)
					? Core.pickLine("error")
					: Core.pickLine("ok", balance.amount, balance.currency, config.warnBelow);

				const clampToViewport = (x, y) => ({
					x: Core.clamp(x, 0, Math.max(0, window.innerWidth - size.width)),
					y: Core.clamp(y, 0, Math.max(0, window.innerHeight - size.height)),
				});

				const onPointerDown = (event) => {
					if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
					event.preventDefault();
					const target = event.currentTarget;
					if (target.setPointerCapture) {
						try { target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
					}
					dragRef.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						originX: pos.x,
						originY: pos.y,
						moved: false,
					};
					setPressing(true);
				};

				const onPointerMove = (event) => {
					const drag = dragRef.current;
					if (!drag || drag.pointerId !== event.pointerId) return;
					const dx = event.clientX - drag.startX;
					const dy = event.clientY - drag.startY;
					if (!drag.moved && Math.hypot(dx, dy) > 4) {
						drag.moved = true;
						setDragging(true);
					}
					if (!drag.moved) return;
					setPos(clampToViewport(drag.originX + dx, drag.originY + dy));
				};

				const onPointerUp = (event) => {
					const drag = dragRef.current;
					if (!drag || drag.pointerId !== event.pointerId) return;
					dragRef.current = null;
					setPressing(false);
					setDragging(false);
					if (!drag.moved) {
						if (open) {
							hidePanel();
						} else {
							balance.refresh();
							showPanel();
						}
						return;
					}
					const next = Core.snapToEdge(pos, size, { width: window.innerWidth, height: window.innerHeight }, { enabled: config.snap, threshold: SNAP_DISTANCE });
					setPos({ x: next.x, y: next.y });
					writePos(next);
				};

				const onContextMenu = (event) => {
					event.preventDefault();
					balance.refresh();
					showPanel();
				};

				const onKeyDown = (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						if (open) hidePanel();
						else { balance.refresh(); showPanel(); }
					}
				};

				const PANEL_HALF = 105;
				const panelLeft = Core.clamp(
					pos.x + size.width / 2,
					8 + PANEL_HALF,
					Math.max(8 + PANEL_HALF, window.innerWidth - 8 - PANEL_HALF),
				);
				const panelBelow = pos.y < 150;

				return h("div", { className: "konfee-root" },
					styleElement(),
					h("div", {
						className: `konfee-table${pressing ? " is-press" : ""}${dragging ? " is-drag" : ""}`,
						"data-konfee": "table",
						"data-width": layout.width,
					"data-box": frame.width,
						"data-state": balance.ok ? (warn ? "warn" : "ok") : balance.configMissing ? "no-key" : "error",
						"data-peak": peak.peak ? "peak" : "valley",
						style: {
							width: `${size.width}px`,
							height: `${size.height}px`,
							transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
						},
						role: "button",
						tabIndex: 0,
						"aria-label": "轻音部费罐：点击查看余额与峰谷",
						title: "点击看部费 · 拖动挪位置 · 右键刷新",
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel: onPointerUp,
						onContextMenu,
						onKeyDown,
					},
						h("div", { className: "konfee-stage" },
							assets ? h(TableBack, { image: assets.desk00, frame }) : null,
							showSeats ? layout.segments.map((segment) => h("div", {
								key: segment.id,
								className: "konfee-seat",
								"data-char": segment.id,
								style: {
									left: `${Math.round((segment.x + frame.offset) * config.scale)}px`,
									top: `${Math.round(segment.y * config.scale)}px`,
									width: `${Math.round((TABLE.widths[segment.id] || TABLE.charWidth) * config.scale)}px`,
									height: `${Math.round(TABLE.charHeight * config.scale)}px`,
								},
							}, assets ? h(SeatSprite, { id: segment.id, image: assets.seats[segment.id] }) : null)) : null,
							assets ? h(TableFront, { image: assets.desk01, frame }) : null,
						),
					),
					spend && !open ? h("div", {
						className: `konfee-spend${panelBelow ? " is-below" : ""}`,
						"data-konfee": "spend",
						style: {
							left: `${Math.round(panelLeft)}px`,
							top: `${Math.round(panelBelow ? pos.y + size.height + 12 : pos.y - 10)}px`,
						},
					},
						h("b", null, `本轮 ${Core.formatCost(spend.amount)}`),
						h("span", null, `${formatTokens(spend.tokens)} tokens`),
						h("span", { className: "konfee-spend-tag" }, spend.peak ? "高峰" : "谷时"),
					) : null,
					open ? h("div", {
						className: `konfee-panel${panelBelow ? " is-below" : ""}`,
						"data-konfee": "panel",
						style: {
							left: `${Math.round(panelLeft)}px`,
							top: `${Math.round(panelBelow ? pos.y + size.height + 12 : pos.y - 10)}px`,
						},
					},
						h("div", { className: "konfee-head" },
							h("span", { className: "konfee-title" }, "轻音部 · 部费账本"),
							h("span", { className: `konfee-tag ${peak.peak ? "is-peak" : "is-valley"}` }, peak.peak ? "高峰" : "谷时"),
						),
						h("div", { className: "konfee-amount-row" },
							moneyParts[0] ? h("span", { className: "konfee-currency" }, moneyParts[0]) : null,
							h("b", { className: `konfee-amount tone-${tone}` }, moneyParts[1]),
						),
						h("div", { className: "konfee-today" },
							today && today.turns > 0
								? `今天 ${Core.formatCost(today.amount)} · ${today.turns} 轮`
								: "今天还没花钱",
							today && today.tokens > 0 ? h("span", { className: "konfee-today-tokens" }, ` · ${formatTokens(today.tokens)} tokens`) : null,
						),
						h("div", { className: "konfee-schedule" }, `高峰 ${Core.PEAK_TEXT}`, h("span", { className: "konfee-schedule-note" }, "工作日；周末全天谷价")),
						h("div", { className: "konfee-meter" },
							h("div", { className: "konfee-track" },
								h("i", {
									className: peak.peak ? "is-peak" : "is-valley",
									style: { width: `${Math.round(peak.progress * 100)}%` },
								}),
							),
							h("div", { className: "konfee-meter-text" },
								h("span", null, peak.nextText || "计价时段"),
								h("span", null, peak.peak ? `高峰 ${peak.detail}` : peak.weekend ? "周末谷价" : "谷时"),
							),
						),
						h("div", { className: "konfee-divider" }),
						h("div", { className: "konfee-line" }, line),
						h("div", { className: "konfee-foot" },
							h("span", { className: `konfee-status tone-${status.tone}` }, status.text),
							h("span", null, balance.ok || balance.stale ? "DeepSeek 余额" : balance.configMissing ? "未配置 key" : "离线"),
						),
					) : null,
				);
			}

			// ---------------- 设置页 ----------------
			function FeeSwitch({ checked, onChange, label, disabled }) {
				return h("button", {
					type: "button",
					role: "switch",
					"aria-checked": checked,
					"aria-label": label,
					disabled,
					className: `konfee-switch${checked ? " is-on" : ""}`,
					onClick: onChange,
				}, h("i"));
			}

			function FeeSettings() {
				const config = useConfig();
				const toggleCharacter = (id) => updateConfig({ characters: { ...config.characters, [id]: !config.characters[id] } });
				const [editing, setEditing] = useState(false);
				const [draft, setDraft] = useState("");
				const [error, setError] = useState("");
				const openEditor = () => {
					setDraft(JSON.stringify(config, null, 2));
					setError("");
					setEditing(true);
				};
				const saveEditor = () => {
					let parsed;
					try {
						parsed = JSON.parse(draft);
					} catch (parseError) {
						setError("JSON 格式不对：" + (parseError && parseError.message ? parseError.message : String(parseError)));
						return;
					}
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
						setError("最外层必须是 { } 包起来的对象");
						return;
					}
					updateConfig(parsed);
					setEditing(false);
				};
				return h("div", { className: "konfee-set" },
					styleElement(),
					h("h2", null, "轻音部费罐"),
					h("section", { className: "konfee-set-card" },
						h("div", { className: "konfee-set-row" },
							h("b", { className: "konfee-set-label" }, "坐上桌的人"),
							h("div", { className: "konfee-chars" },
								...Core.ROSTER.map((member) => h("button", {
									key: member.id,
									type: "button",
									className: `konfee-btn${config.characters[member.id] ? " is-on" : ""}`,
									"aria-pressed": Boolean(config.characters[member.id]),
									"aria-label": member.name,
									onClick: () => toggleCharacter(member.id),
								}, member.name)),
							),
						),
						h("div", { className: "konfee-set-row" },
							h("b", { className: "konfee-set-label" }, "配置"),
							h("button", { type: "button", className: "konfee-btn is-primary", onClick: openEditor }, "编辑配置"),
						),
					),
					editing ? h("div", {
						className: "konfee-modal",
						"data-konfee": "config-editor",
						onClick: (event) => { if (event.target === event.currentTarget) setEditing(false); },
					},
						h("div", { className: "konfee-modal-card" },
							h("div", { className: "konfee-modal-title" }, "编辑配置"),
							h("textarea", {
								className: "konfee-json",
								value: draft,
								spellCheck: false,
								"aria-label": "配置 JSON",
								onChange: (event) => setDraft(event.target.value),
							}),
							error ? h("div", { className: "konfee-modal-error" }, error) : null,
							h("div", { className: "konfee-modal-actions" },
								h("button", { type: "button", className: "konfee-btn", onClick: () => setDraft(JSON.stringify(DEFAULT_CONFIG, null, 2)) }, "恢复默认"),
								h("button", { type: "button", className: "konfee-btn", onClick: () => setEditing(false) }, "取消"),
								h("button", { type: "button", className: "konfee-btn is-primary", onClick: saveEditor }, "保存"),
							),
						),
					) : null,
				);
			}

			// ---------------- 插件注册 ----------------
			const name = "dsh-kon-fee-widget";
			const inject = ["slots"];

			function apply(ctx) {
				ctx.slots.inject("shell.overlay", function* () {
					yield ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-kon-fee-widget",
						order: 880,
					}, FeeWidget);
				});
				ctx.slots.inject("settings.section", function* () {
					yield ctx.slots.register({
						name: "settings.section",
						id: "dsh-kon-fee-widget",
						label: () => "轻音部费罐",
						order: 55,
					}, FeeSettings);
				});
			}

			return { apply, inject, name };
		},
	});
})();
