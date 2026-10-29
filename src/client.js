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
			const PANEL_MS = 6000;

			// ---------------- 设置存储 ----------------
			const listeners = new Set();
			let currentSettings = null;

			function readStored() {
				try {
					const raw = localStorage.getItem(Core.STORE_KEY);
					const parsed = raw ? JSON.parse(raw) : null;
					return parsed && typeof parsed === "object" ? parsed : null;
				} catch {
					return null;
				}
			}

			function persist(settings) {
				try {
					localStorage.setItem(Core.STORE_KEY, JSON.stringify(settings));
				} catch {
					/* 隐私模式下不可写，内存状态仍然有效 */
				}
			}

			function notify() {
				for (const fn of listeners) {
					try { fn(); } catch { /* 单个订阅失败不影响别人 */ }
				}
			}

			function getSettings() {
				if (!currentSettings) currentSettings = Core.sanitizeSettings(readStored() || {});
				return currentSettings;
			}

			function updateSettings(patch) {
				const previous = getSettings();
				const raw = typeof patch === "function" ? patch(previous) : patch;
				const next = Core.sanitizeSettings({ ...previous, ...raw });
				currentSettings = next;
				persist(next);
				notify();
				return next;
			}

			function useSettings() {
				const [, force] = useState(0);
				useEffect(() => {
					const listener = () => force((value) => value + 1);
					listeners.add(listener);
					return () => listeners.delete(listener);
				}, []);
				return getSettings();
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
.konfee-panel{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);min-width:190px;max-width:250px;padding:10px 13px;border-radius:14px;background:rgba(255,255,255,.97);color:#3a3340;border:1px solid rgba(70,55,80,.12);box-shadow:0 12px 30px rgba(40,30,55,.22);pointer-events:none;z-index:9;animation:konfee-pop .18s cubic-bezier(.2,1.4,.4,1)}
.konfee-panel:after{content:"";position:absolute;left:50%;top:100%;width:10px;height:10px;margin-left:-6px;margin-top:-5px;background:inherit;border-right:1px solid rgba(70,55,80,.12);border-bottom:1px solid rgba(70,55,80,.12);transform:rotate(45deg)}
@keyframes konfee-pop{from{opacity:0;transform:translateX(-50%) translateY(4px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
.konfee-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.konfee-label{font-size:10px;letter-spacing:.14em;color:#9a91a2}
.konfee-amount{font-size:22px;font-weight:650;line-height:1.2;font-variant-numeric:tabular-nums}
.konfee-amount.tone-warn{color:#c25b4e}
.konfee-amount.tone-error{color:#a08b8b;font-size:15px}
.konfee-meta{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:#7c7385}
.konfee-tag{flex:none;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid transparent}
.konfee-tag.is-peak{color:#b3503f;background:rgba(214,88,88,.12);border-color:rgba(214,88,88,.3)}
.konfee-tag.is-valley{color:#4d7a5c;background:rgba(95,138,106,.14);border-color:rgba(95,138,106,.32)}
.konfee-line{margin-top:6px;font-size:11px;line-height:1.5;color:#8c8395}
.konfee-status{font-size:10px;color:#9a91a2;margin-top:4px}
.konfee-status.tone-error{color:#c25b4e}
.konfee-set{padding:2px 0 26px;font-size:13px;line-height:1.6;color:inherit}
.konfee-set h2{font-size:18px;font-weight:650;margin:0 0 4px}
.konfee-set-sub{font-size:12px;opacity:.6;margin:0 0 16px}
.konfee-set-card{border:1px solid rgba(127,127,127,.2);border-radius:14px;padding:6px 16px;margin:0 0 14px;background:rgba(127,127,127,.035)}
.konfee-set-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid rgba(127,127,127,.12)}
.konfee-set-row:first-child{border-top:0}
.konfee-set-name{flex:1;min-width:0}
.konfee-set-name b{display:block;font-size:13px;font-weight:600}
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
`;

			function styleElement() {
				return h("style", { "data-konfee-style": "inline", dangerouslySetInnerHTML: { __html: CSS } });
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

			function useBalance(settings) {
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
					const interval = Math.max(10, Number(settings.refreshSeconds) || 60) * 1000;
					const timer = window.setInterval(refresh, interval);
					return () => {
						alive.current = false;
						window.clearInterval(timer);
					};
				}, [refresh, settings.refreshSeconds]);

				return { ...state, refresh };
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

			/** 桌面背景：desk00 是 4 帧横向动画。 */
			function TableBack({ image }) {
				const ref = useRef(null);
				useEffect(() => {
					const canvas = ref.current;
					if (!canvas || !image) return undefined;
					const context = canvas.getContext("2d");
					const frames = Math.max(1, Math.floor(image.naturalWidth / TABLE.width));
					let raf = 0;
					let acc = 0;
					let last = performance.now();
					let frame = 0;
					const draw = () => {
						context.clearRect(0, 0, TABLE.width, TABLE.height);
						context.drawImage(image, (frame % frames) * TABLE.width, 0, TABLE.width, TABLE.height, 0, 0, TABLE.width, TABLE.height);
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
					raf = requestAnimationFrame(tick);
					return () => cancelAnimationFrame(raf);
				}, [image]);
				return h("canvas", { ref, width: TABLE.width, height: TABLE.height, className: "konfee-back", "aria-hidden": "true" });
			}

			/** 前景：desk01 盖在人物前面。 */
			function TableFront({ image }) {
				const ref = useRef(null);
				useEffect(() => {
					const canvas = ref.current;
					if (!canvas || !image) return;
					const context = canvas.getContext("2d");
					context.clearRect(0, 0, TABLE.width, TABLE.height);
					context.drawImage(image, 0, 0);
				}, [image]);
				return h("canvas", { ref, width: TABLE.width, height: TABLE.height, className: "konfee-front", "aria-hidden": "true" });
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
				const settings = useSettings();
				const balance = useBalance(settings);
				const assets = useTableAssets();
				const size = {
					width: Math.round(TABLE.width * settings.scale),
					height: Math.round(TABLE.height * settings.scale),
				};
				const [pos, setPos] = useState(() => settings.pos || Core.defaultPosition(size, { width: window.innerWidth, height: window.innerHeight }));
				const [pressing, setPressing] = useState(false);
				const [dragging, setDragging] = useState(false);
				const [open, setOpen] = useState(false);
				const [now, setNow] = useState(() => Date.now());
				const dragRef = useRef(null);
				const panelTimer = useRef(0);

				// 位置：设置里重置（pos=null）时回到默认左下角
				useEffect(() => {
					setPos(settings.pos || Core.defaultPosition(size, { width: window.innerWidth, height: window.innerHeight }));
				}, [settings.pos, settings.scale]);

				useEffect(() => {
					const onResize = () => {
						setPos((previous) => {
							const next = Core.snapToEdge(previous, size, { width: window.innerWidth, height: window.innerHeight }, { enabled: settings.snap, threshold: SNAP_DISTANCE });
							return { x: next.x, y: next.y };
						});
					};
					window.addEventListener("resize", onResize);
					return () => window.removeEventListener("resize", onResize);
				}, [settings.snap, size.width, size.height]);

				// 账本开着的时候每分钟刷新一次峰谷状态
				useEffect(() => {
					if (!open) return undefined;
					const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000);
					return () => window.clearInterval(timer);
				}, [open]);

				useEffect(() => () => window.clearTimeout(panelTimer.current), []);

				const showPanel = useCallback(() => {
					setOpen(true);
					setNow(Date.now());
					window.clearTimeout(panelTimer.current);
					panelTimer.current = window.setTimeout(() => setOpen(false), PANEL_MS);
				}, []);

				const hidePanel = useCallback(() => {
					setOpen(false);
					window.clearTimeout(panelTimer.current);
				}, []);

				if (!settings.visible) return null;

				const peak = Core.priceWindow(now);
				const status = Core.statusInfo(balance);
				const warn = Boolean(balance.ok && balance.amount <= settings.warnBelow);
				const tone = warn ? "warn" : balance.ok || balance.stale ? "ok" : "error";
				const amountText = balance.ok || balance.stale
					? Core.formatMoney(balance.amount, balance.currency)
					: balance.configMissing ? "未配置" : balance.error ? "读取失败" : "…";
				const line = balance.configMissing || (!balance.ok && !balance.stale)
					? Core.pickLine("error")
					: Core.pickLine("ok", balance.amount, balance.currency, settings.warnBelow);

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
					const next = Core.snapToEdge(pos, size, { width: window.innerWidth, height: window.innerHeight }, { enabled: settings.snap, threshold: SNAP_DISTANCE });
					setPos({ x: next.x, y: next.y });
					updateSettings({ pos: { x: next.x, y: next.y }, edge: next.edge });
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

				const seats = TABLE.seats.filter((seat) => settings.showAll || settings.characters[seat.id]);

				return h("div", { className: "konfee-root" },
					styleElement(),
					h("div", {
						className: `konfee-table${pressing ? " is-press" : ""}${dragging ? " is-drag" : ""}`,
						"data-konfee": "table",
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
							assets ? h(TableBack, { image: assets.desk00 }) : null,
							...seats.map((seat) => h("div", {
								key: seat.id,
								className: "konfee-seat",
								"data-char": seat.id,
								style: {
									left: `${Math.round(seat.x * settings.scale)}px`,
									top: `${Math.round(TABLE.charTop * settings.scale)}px`,
									width: `${Math.round((TABLE.widths[seat.id] || TABLE.charWidth) * settings.scale)}px`,
									height: `${Math.round(TABLE.charHeight * settings.scale)}px`,
								},
							}, assets ? h(SeatSprite, { id: seat.id, image: assets.seats[seat.id] }) : null)),
							assets ? h(TableFront, { image: assets.desk01 }) : null,
							open ? h("div", { className: "konfee-panel", "data-konfee": "panel" },
								h("div", { className: "konfee-row" },
									h("span", { className: "konfee-label" }, "部费"),
									h("b", { className: `konfee-amount tone-${tone}` }, amountText),
								),
								h("div", { className: "konfee-meta" },
									h("span", { className: `konfee-tag ${peak.peak ? "is-peak" : "is-valley"}` }, peak.peak ? "高峰" : "谷时"),
									h("span", null, peak.peak ? `${peak.detail} 计价较高` : peak.detail),
								),
								h("div", { className: "konfee-line" }, line),
								h("div", { className: `konfee-status tone-${status.tone}` }, status.text),
							) : null,
						),
					),
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
				const settings = useSettings();
				const balance = useBalance(settings);
				const status = Core.statusInfo(balance);
				const peak = Core.priceWindow();
				return h("div", { className: "konfee-set" },
					styleElement(),
					h("h2", null, "轻音部费罐"),
					h("p", { className: "konfee-set-sub" }, "原版茶桌当底座，五人坐满；平时不显示数字，点一下茶桌才弹出账本：余额 + 峰谷 + 更新时间。"),
					h("section", { className: "konfee-set-card" },
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "显示挂件"),
								h("small", null, "关掉后茶桌不再出现"),
							),
							h(FeeSwitch, { checked: settings.visible, onChange: () => updateSettings({ visible: !settings.visible }), label: "显示挂件" }),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "全展示"),
								h("small", null, "五个人都坐上桌；关掉后按下面单独勾选"),
							),
							h(FeeSwitch, { checked: settings.showAll, onChange: () => updateSettings({ showAll: !settings.showAll }), label: "全展示" }),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "坐桌上的人"),
								h("small", null, settings.showAll ? "「全展示」开着，这里暂时不能单独改" : "勾选谁坐在桌上"),
							),
							h("div", { className: "konfee-chars" },
								...Core.ROSTER.map((member) => h("button", {
									key: member.id,
									type: "button",
									className: `konfee-btn${settings.characters[member.id] ? " is-on" : ""}`,
									disabled: settings.showAll,
									"aria-pressed": settings.characters[member.id],
									onClick: () => updateSettings({ characters: { ...settings.characters, [member.id]: !settings.characters[member.id] } }),
								}, member.name)),
							),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "大小"),
								h("small", null, "整张茶桌缩放"),
							),
							h("input", {
								className: "konfee-range",
								type: "range",
								min: Core.SCALE_MIN,
								max: Core.SCALE_MAX,
								step: 0.05,
								value: settings.scale,
								"aria-label": "挂件大小",
								onChange: (event) => updateSettings({ scale: Number(event.target.value) }),
							}),
							h("span", { className: "konfee-value" }, `${settings.scale.toFixed(2)}×`),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "贴边吸附"),
								h("small", null, "拖到边缘松手会自动贴边"),
							),
							h(FeeSwitch, { checked: settings.snap, onChange: () => updateSettings({ snap: !settings.snap }), label: "贴边吸附" }),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "刷新间隔"),
								h("small", null, "余额多久拉一次（点茶桌也会刷新）"),
							),
							h("div", { style: { display: "flex", gap: "6px" } },
								...Core.REFRESH_OPTIONS.map((seconds) => h("button", {
									key: seconds,
									type: "button",
									className: `konfee-btn${settings.refreshSeconds === seconds ? " is-on" : ""}`,
									onClick: () => updateSettings({ refreshSeconds: seconds }),
								}, `${seconds} 秒`)),
							),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "低余额提醒"),
								h("small", null, "低于这个金额时数字变红、台词变省钱"),
							),
							h("input", {
								className: "konfee-range",
								type: "range",
								min: 0,
								max: 50,
								step: 1,
								value: settings.warnBelow,
								"aria-label": "低余额阈值",
								onChange: (event) => updateSettings({ warnBelow: Number(event.target.value) }),
							}),
							h("span", { className: "konfee-value" }, Core.formatMoney(settings.warnBelow)),
						),
					),
					h("section", { className: "konfee-set-card" },
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "当前余额"),
								h("small", null, `数据来源：${balance.configMissing ? "未配置 API key" : balance.ok ? "DeepSeek 余额接口" : balance.error || "等待刷新"}`),
							),
							h("span", { className: "konfee-value", style: { width: "auto" } }, balance.ok || balance.stale ? Core.formatMoney(balance.amount, balance.currency) : "—"),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "计价时段"),
								h("small", null, `现在是${peak.label}${peak.peak ? `（${peak.detail}）` : `：${peak.detail}`}`),
							),
							h("div", { style: { display: "flex", gap: "6px" } },
								h("button", { type: "button", className: "konfee-btn", onClick: () => balance.refresh() }, "立即刷新"),
								h("button", { type: "button", className: "konfee-btn", onClick: () => updateSettings({ pos: null, edge: null }) }, "重置位置"),
							),
						),
						h("div", { className: "konfee-set-row" },
							h("div", { className: "konfee-set-name" },
								h("b", null, "状态"),
								h("small", null, status.text),
							),
						),
						h("p", { className: "konfee-note" }, "余额由 DSH 宿主侧读凭据后请求 DeepSeek 接口，API key 不会下发到页面；读不到时显示上次的余额。峰谷按北京时间：工作日 9:00–12:00、14:00–18:00 为高峰，其余时间为谷时，周末全天谷价。"),
					),
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
