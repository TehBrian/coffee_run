"use client";

import Matter from "matter-js";
import {
	type MutableRefObject,
	type MouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PourState {
	pendingBlocks: number;
}

interface CaffeineBlock {
	body: Matter.Body;
}

interface StaticBoundsBodies {
	ground: Matter.Body;
	wallL: Matter.Body;
	wallR: Matter.Body;
}

interface SoundPool {
	template: HTMLAudioElement | null;
	active: Set<HTMLAudioElement>;
}

type Phase = "normal" | "hyper" | "black";
type AscensionStep =
	| "idle"
	| "welcome"
	| "ascended"
	| "realm"
	| "blinding"
	| "dead";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * clamp(t, 0, 1);
}

function getPhase(mg: number): Phase {
	if (mg >= 3400) return "black";
	if (mg >= 1400) return "hyper";
	return "normal";
}

function getViewportSize() {
	if (typeof window !== "undefined" && window.visualViewport) {
		return {
			w: Math.round(window.visualViewport.width),
			h: Math.round(window.visualViewport.height),
		};
	}
	return { w: window.innerWidth, h: window.innerHeight };
}

function createStaticBounds(w: number, h: number): StaticBoundsBodies {
	const wallThickness = 48;
	const groundThickness = 64;

	return {
		ground: Matter.Bodies.rectangle(
			w / 2,
			h + groundThickness * 0.5,
			w,
			groundThickness,
			{
				isStatic: true,
				label: "ground",
				collisionFilter: { category: 0x0002, mask: 0xffff },
			},
		),
		wallL: Matter.Bodies.rectangle(
			-wallThickness * 0.5,
			h * 0.5,
			wallThickness,
			h,
			{
				isStatic: true,
				label: "wallL",
				collisionFilter: { category: 0x0002, mask: 0xffff },
			},
		),
		wallR: Matter.Bodies.rectangle(
			w + wallThickness * 0.5,
			h * 0.5,
			wallThickness,
			h,
			{
				isStatic: true,
				label: "wallR",
				collisionFilter: { category: 0x0002, mask: 0xffff },
			},
		),
	};
}

interface EffectParams {
	blackOverlay: number; // 0–1
	whiteOverlay: number; // 0–1
	blur: number; // px
	dvOffset: number; // px double-vision
	chromatic: number; // px aberration
	jitterAmp: number; // px
	jitterFreq: number; // hz
	smileT: number; // 0=smile, 1=frown
	smileBoost: number; // 0=normal smile curve, 1=super happy curve
}

function computeEffects(mg: number): EffectParams {
	if (mg <= 1400) {
		const t = mg / 1400;
		return {
			blackOverlay: lerp(0, 0.8, t),
			whiteOverlay: 0,
			blur: lerp(0, 2, t),
			dvOffset: lerp(0, 12, t),
			chromatic: 0,
			jitterAmp: 0,
			jitterFreq: 0,
			smileT: t,
			smileBoost: 0,
		};
	}

	if (mg <= 1800) {
		const t_a = (mg - 1400) / 400;
		const recoveryT = (mg - 1400) / 1800;
		return {
			blackOverlay: lerp(0.8, 0, t_a),
			whiteOverlay: 0,
			blur: lerp(2, 0, t_a),
			dvOffset: lerp(12, 0, t_a),
			chromatic: 0,
			jitterAmp: 0,
			jitterFreq: 0,
			smileT: lerp(1, 0.78, recoveryT),
			smileBoost: 0,
		};
	}

	if (mg < 3200) {
		const t_b = (mg - 1800) / 1400;
		const recoveryT = (mg - 1400) / 1800;
		return {
			blackOverlay: 0,
			whiteOverlay: lerp(0, 0.65, t_b),
			blur: 0,
			dvOffset: lerp(0, 26, t_b),
			chromatic: lerp(0, 30, t_b),
			jitterAmp: t_b > 0.1 ? lerp(0, 8, (t_b - 0.1) / 0.9) : 0,
			jitterFreq: t_b > 0.1 ? lerp(0, 30, (t_b - 0.1) / 0.9) : 0,
			smileT: lerp(1, 0, recoveryT),
			smileBoost: t_b,
		};
	}

	return {
		blackOverlay: 0,
		whiteOverlay: 0.65,
		blur: 0,
		dvOffset: 26,
		chromatic: 30,
		jitterAmp: 8,
		jitterFreq: 30,
		smileT: 0,
		smileBoost: 1,
	};
}

function getNarrativeCopy(mg: number) {
	if (mg >= 1350) {
		return {
			title: "But what if I kept going?",
			subtitle: "What if I needed just a bit more?",
		};
	}

	if (mg >= 1150) {
		return {
			title: "They said to stop.",
			subtitle:
				"Something something my heart\nwould explode something something.",
		};
	}

	if (mg >= 900) {
		return {
			title: "I kept chugging.",
			subtitle: "And I kept drifting.",
		};
	}

	if (mg >= 600) {
		return {
			title: "But I just felt sleepier.",
			subtitle: "Where was the high?",
		};
	}

	if (mg >= 300) {
		return {
			title: "They said it'd be fun.",
			subtitle: "I thought so too.",
		};
	}

	return {
		title: "Welcome.",
		subtitle: "Try some caffeine!",
	};
}

// ─── Caffeine Blocks ──────────────────────────────────────────────────────────

const CAFFEINE_BLOCK_MG = 4;
const MAX_ACTIVE_BLOCKS = 5000;
const BLOCK_SPAWN_PER_FRAME = 4;
const REALM_LINE_MS = 1450;
const WHITEOUT_DURATION_MS = 4900;
const WHITEOUT_HOLD_MS = 400;
const ENDING_SETTLE_BUFFER_MS = 650;

const BUTTON_BG = "rgba(246,230,211,0.82)";
const BUTTON_BG_HOVER = "rgba(252,240,225,0.92)";
const BUTTON_STYLE = {
	background: BUTTON_BG,
	border: "1px solid rgba(88,52,31,0.55)",
	borderRadius: "12px",
	padding: "21px 30px",
	color: "rgba(24,10,0,0.96)",
	cursor: "pointer",
	textAlign: "left" as const,
	boxShadow: "0 10px 24px rgba(30,12,0,0.18)",
	transition: "background 0.2s",
	fontSize: "0.95rem",
	lineHeight: 1.4,
};

function makeCaffeineBlock(
	engine: Matter.Engine,
	sourceX: number,
	sourceY: number,
) {
	const radius = (7 + Math.random() * 2) * 1.5;
	const body = Matter.Bodies.circle(
		sourceX + (Math.random() - 0.5) * 24,
		sourceY + Math.random() * 12,
		radius,
		{
			label: "caffeine-block",
			restitution: 0.22,
			friction: 0.06,
			frictionAir: 0.014,
			density: 0.002,
			collisionFilter: {
				category: 0x0010,
				mask: 0x0002 | 0x0008 | 0x0010,
			},
		},
	);
	Matter.Body.setVelocity(body, {
		x: (Math.random() - 0.5) * 1.6,
		y: 1.3 + Math.random() * 0.8,
	});
	Matter.World.add(engine.world, body);

	const block: CaffeineBlock = { body };
	return block;
}

// ─── Stick Figure Drawing ─────────────────────────────────────────────────────

interface FigureBodies {
	head: Matter.Body;
	torso: Matter.Body;
	upperArmL: Matter.Body;
	lowerArmL: Matter.Body;
	upperArmR: Matter.Body;
	lowerArmR: Matter.Body;
	upperLegL: Matter.Body;
	lowerLegL: Matter.Body;
	upperLegR: Matter.Body;
	lowerLegR: Matter.Body;
}

function drawStickFigure(
	ctx: CanvasRenderingContext2D,
	fig: FigureBodies,
	smileT: number,
	smileBoost: number,
	deadEyes = false,
) {
	ctx.save();
	ctx.strokeStyle = "#2a1a00";
	ctx.fillStyle = "#2a1a00";
	const headR = fig.head.circleRadius ?? 20;
	const drawScale = headR / 20;
	ctx.lineWidth = 3 * drawScale;
	ctx.lineCap = "round";

	const pos = (b: Matter.Body) => b.position;

	// Body segments
	const segments: [Matter.Body, Matter.Body][] = [
		[fig.torso, fig.upperArmL],
		[fig.upperArmL, fig.lowerArmL],
		[fig.torso, fig.upperArmR],
		[fig.upperArmR, fig.lowerArmR],
		[fig.torso, fig.upperLegL],
		[fig.upperLegL, fig.lowerLegL],
		[fig.torso, fig.upperLegR],
		[fig.upperLegR, fig.lowerLegR],
	];

	ctx.beginPath();
	for (const [a, b] of segments) {
		ctx.moveTo(pos(a).x, pos(a).y);
		ctx.lineTo(pos(b).x, pos(b).y);
	}
	ctx.stroke();

	const h = pos(fig.head);
	const torsoCenter = pos(fig.torso);
	const torsoNeckAnchor = {
		x: torsoCenter.x,
		y: torsoCenter.y - 7 * drawScale,
	};
	const headToTorso = Matter.Vector.sub(torsoNeckAnchor, h);
	const headToTorsoLen = Matter.Vector.magnitude(headToTorso);
	const headDir =
		headToTorsoLen > 0.0001
			? Matter.Vector.mult(headToTorso, 1 / headToTorsoLen)
			: { x: 0, y: 1 };
	const headNeckAnchor = Matter.Vector.add(
		h,
		Matter.Vector.mult(headDir, headR - 0.25 * drawScale),
	);
	ctx.save();
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.arc(h.x, h.y, Math.max(0, headR - 0.9 * drawScale), 0, Math.PI * 2, true);
	ctx.clip("evenodd");
	ctx.beginPath();
	ctx.moveTo(headNeckAnchor.x, headNeckAnchor.y);
	ctx.lineTo(torsoNeckAnchor.x, torsoNeckAnchor.y);
	ctx.stroke();
	ctx.restore();

	// Head circle
	ctx.beginPath();
	ctx.arc(h.x, h.y, headR, 0, Math.PI * 2);
	ctx.stroke();

	// Eyes
	if (deadEyes) {
		ctx.strokeStyle = "#2a1a00";
		ctx.lineWidth = 2.2 * drawScale;
		const eyeY = h.y - 5 * drawScale;
		const eyeDX = 6 * drawScale;
		const crossR = 3.5 * drawScale;

		ctx.beginPath();
		ctx.moveTo(h.x - eyeDX - crossR, eyeY - crossR);
		ctx.lineTo(h.x - eyeDX + crossR, eyeY + crossR);
		ctx.moveTo(h.x - eyeDX + crossR, eyeY - crossR);
		ctx.lineTo(h.x - eyeDX - crossR, eyeY + crossR);

		ctx.moveTo(h.x + eyeDX - crossR, eyeY - crossR);
		ctx.lineTo(h.x + eyeDX + crossR, eyeY + crossR);
		ctx.moveTo(h.x + eyeDX + crossR, eyeY - crossR);
		ctx.lineTo(h.x + eyeDX - crossR, eyeY + crossR);
		ctx.stroke();
	} else {
		ctx.fillStyle = "#2a1a00";
		ctx.beginPath();
		ctx.arc(
			h.x - 6 * drawScale,
			h.y - 5 * drawScale,
			2.5 * drawScale,
			0,
			Math.PI * 2,
		);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(
			h.x + 6 * drawScale,
			h.y - 5 * drawScale,
			2.5 * drawScale,
			0,
			Math.PI * 2,
		);
		ctx.fill();
	}

	// Name label above head
	ctx.font = `bold ${Math.round(18 * drawScale)}px sans-serif`;
	ctx.textAlign = "center";
	ctx.fillStyle = "#2a1a00";
	ctx.fillText("Brian", h.x, h.y - headR - 8 * drawScale);

	// Mouth: smile (smileT=0) → frown (smileT=1)
	const mouthY = h.y + 7 * drawScale;

	ctx.beginPath();
	ctx.strokeStyle = "#2a1a00";
	ctx.lineWidth = 2.5 * drawScale;
	ctx.moveTo(h.x - 8 * drawScale, mouthY);
	if (deadEyes) {
		ctx.lineTo(h.x + 8 * drawScale, mouthY);
	} else {
		const smileControlY =
			mouthY +
			lerp(8 * drawScale, -8 * drawScale, smileT) -
			+5 * drawScale * clamp(smileBoost, 0, 1);
		ctx.quadraticCurveTo(h.x, smileControlY, h.x + 8 * drawScale, mouthY);
	}
	ctx.stroke();

	ctx.restore();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CoffeeGame() {
	const mainCanvasRef = useRef<HTMLCanvasElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const ghostRef = useRef<HTMLDivElement>(null);
	const ghostCanvasRef = useRef<HTMLCanvasElement>(null);

	const engineRef = useRef<Matter.Engine | null>(null);
	const figureRef = useRef<FigureBodies | null>(null);
	const caffeineBlocksRef = useRef<CaffeineBlock[]>([]);
	const rafRef = useRef<number>(0);
	const jitterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const mouseConstraintRef = useRef<Matter.MouseConstraint | null>(null);
	const staticBoundsRef = useRef<StaticBoundsBodies | null>(null);
	const renderSizeRef = useRef({ w: 0, h: 0 });
	const pourStateRef = useRef<PourState>({ pendingBlocks: 0 });

	const [caffeineLevel, setCaffeineLevel] = useState(0);
	const caffeineLevelRef = useRef(0);
	const [phase, setPhase] = useState<Phase>("normal");
	const [jitter, setJitter] = useState({ x: 0, y: 0 });
	const [ascStep, setAscStep] = useState<AscensionStep>("idle");
	const [ascText, setAscText] = useState<"welcome" | "ascended" | null>(null);
	const [ascWhiteOverlay, setAscWhiteOverlay] = useState(0);
	const [ascWhiteTransitionMs, setAscWhiteTransitionMs] = useState(600);
	const ascStepRef = useRef<AscensionStep>("idle");
	const blackTransitionReadyRef = useRef(false);
	const ascTimersRef = useRef<number[]>([]);
	const riseSoundPoolRef = useRef<SoundPool>({
		template: null,
		active: new Set(),
	});
	const snapSoundPoolRef = useRef<SoundPool>({
		template: null,
		active: new Set(),
	});
	const clickSoundPoolRef = useRef<SoundPool>({
		template: null,
		active: new Set(),
	});

	const playFromPool = useCallback(
		(poolRef: MutableRefObject<SoundPool>, src: string, volume = 1) => {
			if (!poolRef.current.template) {
				const template = new Audio(src);
				template.preload = "auto";
				template.volume = volume;
				poolRef.current.template = template;
			}

			const template = poolRef.current.template;
			if (!template) return;

			const sound = template.cloneNode(true) as HTMLAudioElement;
			sound.volume = volume;
			poolRef.current.active.add(sound);

			const cleanup = () => {
				poolRef.current.active.delete(sound);
				sound.removeEventListener("ended", cleanup);
				sound.removeEventListener("error", cleanup);
			};

			sound.addEventListener("ended", cleanup);
			sound.addEventListener("error", cleanup);

			void sound.play().catch(() => {
				cleanup();
				// Ignore playback rejection if the file is missing or blocked.
			});
		},
		[],
	);

	useEffect(() => {
		return () => {
			for (const poolRef of [
				riseSoundPoolRef,
				snapSoundPoolRef,
				clickSoundPoolRef,
			]) {
				for (const sound of poolRef.current.active) {
					sound.pause();
					sound.currentTime = 0;
				}
				poolRef.current.active.clear();
				poolRef.current.template = null;
			}
		};
	}, []);

	// Keep ref in sync
	useEffect(() => {
		caffeineLevelRef.current = caffeineLevel;
	}, [caffeineLevel]);

	useEffect(() => {
		ascStepRef.current = ascStep;
	}, [ascStep]);

	const clearAscTimers = useCallback(() => {
		for (const id of ascTimersRef.current) window.clearTimeout(id);
		ascTimersRef.current = [];
	}, []);

	const clearCaffeineBlocks = useCallback(() => {
		const engine = engineRef.current;
		if (engine) {
			for (const block of caffeineBlocksRef.current) {
				Matter.World.remove(engine.world, block.body);
			}
		}
		caffeineBlocksRef.current = [];
		pourStateRef.current.pendingBlocks = 0;
	}, []);

	const queueAscTimeout = useCallback((fn: () => void, ms: number) => {
		const id = window.setTimeout(fn, ms);
		ascTimersRef.current.push(id);
	}, []);

	const placeFigureForEnding = useCallback(() => {
		const fig = figureRef.current;
		if (!fig) return;

		const { w, h } = renderSizeRef.current;
		const bodies = [
			fig.head,
			fig.torso,
			fig.upperArmL,
			fig.lowerArmL,
			fig.upperArmR,
			fig.lowerArmR,
			fig.upperLegL,
			fig.lowerLegL,
			fig.upperLegR,
			fig.lowerLegR,
		];

		// Middle of the room, raised above the floor to allow a brief settle.
		const baseX = w * 0.5;
		const baseY = h - 110;
		const offsets = [
			{ x: -48, y: -75, angle: -0.22 },
			{ x: -12, y: -42, angle: -0.08 },
			{ x: -60, y: -28, angle: 0.24 },
			{ x: -78, y: -8, angle: 0.46 },
			{ x: 22, y: -30, angle: -0.26 },
			{ x: 56, y: -8, angle: -0.44 },
			{ x: -8, y: 10, angle: 0.12 },
			{ x: -26, y: 36, angle: 0.32 },
			{ x: 24, y: 8, angle: -0.14 },
			{ x: 46, y: 34, angle: -0.34 },
		];

		for (let i = 0; i < bodies.length; i++) {
			const body = bodies[i]!;
			const o = offsets[i]!;
			Matter.Body.setPosition(body, { x: baseX + o.x, y: baseY + o.y });
			Matter.Body.setVelocity(body, { x: 0, y: 0 });
			Matter.Body.setAngularVelocity(body, 0);
			Matter.Body.setAngle(body, o.angle);
		}
	}, []);

	useEffect(() => {
		if (ascStep !== "blinding") {
			return;
		}
		playFromPool(riseSoundPoolRef, "/rise.wav");
	}, [ascStep, playFromPool]);

	// ── Physics Init ────────────────────────────────────────────────────────────
	useEffect(() => {
		const { w, h } = getViewportSize();
		renderSizeRef.current = { w, h };

		const engine = Matter.Engine.create({
			gravity: { x: 0, y: 5.4 },
			constraintIterations: 8,
			positionIterations: 10,
			velocityIterations: 8,
		});
		engineRef.current = engine;

		const staticBounds = createStaticBounds(w, h);
		staticBoundsRef.current = staticBounds;
		Matter.World.add(engine.world, Object.values(staticBounds));

		// ── Stick Figure ──────────────────────────────────────────────────────────
		const fx = w * 0.75;
		const fy = h * 0.4;
		const figureScale = 1.35 * 1.5;
		const figureCollisionFilter = {
			category: 0x0008,
			mask: 0x0002 | 0x0008 | 0x0010,
			group: -1,
		};

		const figOpts = (label: string, extra?: object) => ({
			label,
			frictionAir: 0.1,
			restitution: 0.3,
			collisionFilter: figureCollisionFilter,
			...extra,
		});

		const head = Matter.Bodies.circle(
			fx,
			fy - 72 * figureScale,
			20 * figureScale,
			figOpts("head", { mass: 1 }),
		);
		const torso = Matter.Bodies.rectangle(
			fx,
			fy,
			10 * figureScale,
			50 * figureScale,
			figOpts("torso", { mass: 3 }),
		);
		const upperArmL = Matter.Bodies.rectangle(
			fx - 28 * figureScale,
			fy - 20 * figureScale,
			8 * figureScale,
			28 * figureScale,
			figOpts("upperArmL"),
		);
		const lowerArmL = Matter.Bodies.rectangle(
			fx - 28 * figureScale,
			fy + 10 * figureScale,
			8 * figureScale,
			28 * figureScale,
			figOpts("lowerArmL"),
		);
		const upperArmR = Matter.Bodies.rectangle(
			fx + 28 * figureScale,
			fy - 20 * figureScale,
			8 * figureScale,
			28 * figureScale,
			figOpts("upperArmR"),
		);
		const lowerArmR = Matter.Bodies.rectangle(
			fx + 28 * figureScale,
			fy + 10 * figureScale,
			8 * figureScale,
			28 * figureScale,
			figOpts("lowerArmR"),
		);
		const upperLegL = Matter.Bodies.rectangle(
			fx - 12 * figureScale,
			fy + 50 * figureScale,
			8 * figureScale,
			30 * figureScale,
			figOpts("upperLegL"),
		);
		const lowerLegL = Matter.Bodies.rectangle(
			fx - 12 * figureScale,
			fy + 84 * figureScale,
			8 * figureScale,
			30 * figureScale,
			figOpts("lowerLegL"),
		);
		const upperLegR = Matter.Bodies.rectangle(
			fx + 12 * figureScale,
			fy + 50 * figureScale,
			8 * figureScale,
			30 * figureScale,
			figOpts("upperLegR"),
		);
		const lowerLegR = Matter.Bodies.rectangle(
			fx + 12 * figureScale,
			fy + 84 * figureScale,
			8 * figureScale,
			30 * figureScale,
			figOpts("lowerLegR"),
		);

		const mkC = (
			a: Matter.Body,
			b: Matter.Body,
			stiffness: number,
			length?: number,
			pA?: { x: number; y: number },
			pB?: { x: number; y: number },
		) => {
			const pointA = pA ?? { x: 0, y: 0 };
			const pointB = pB ?? { x: 0, y: 0 };
			const resolvedLength =
				length ??
				Math.hypot(
					a.position.x + pointA.x - (b.position.x + pointB.x),
					a.position.y + pointA.y - (b.position.y + pointB.y),
				);

			return Matter.Constraint.create({
				bodyA: a,
				bodyB: b,
				pointA,
				pointB,
				stiffness,
				length: resolvedLength,
				damping: 0.4,
			});
		};

		const constraints = [
			// Neck: bottom of head to top of torso
			mkC(
				head,
				torso,
				0.98,
				3 * figureScale,
				{ x: 0, y: 18 * figureScale },
				{ x: 0, y: -22 * figureScale },
			),
			// Shoulder L: left side of torso top to top of upperArmL
			mkC(
				torso,
				upperArmL,
				0.96,
				undefined,
				{ x: -5 * figureScale, y: -20 * figureScale },
				{ x: 0, y: -14 * figureScale },
			),
			// Elbow L
			mkC(
				upperArmL,
				lowerArmL,
				0.9,
				undefined,
				{ x: 0, y: 14 * figureScale },
				{ x: 0, y: -14 * figureScale },
			),
			// Shoulder R: right side of torso top to top of upperArmR
			mkC(
				torso,
				upperArmR,
				0.96,
				undefined,
				{ x: 5 * figureScale, y: -20 * figureScale },
				{ x: 0, y: -14 * figureScale },
			),
			// Elbow R
			mkC(
				upperArmR,
				lowerArmR,
				0.9,
				undefined,
				{ x: 0, y: 14 * figureScale },
				{ x: 0, y: -14 * figureScale },
			),
			// Hip L: left side of torso bottom to top of upperLegL
			mkC(
				torso,
				upperLegL,
				0.98,
				undefined,
				{ x: -5 * figureScale, y: 25 * figureScale },
				{ x: 0, y: -15 * figureScale },
			),
			// Knee L
			mkC(
				upperLegL,
				lowerLegL,
				0.94,
				undefined,
				{ x: 0, y: 15 * figureScale },
				{ x: 0, y: -15 * figureScale },
			),
			// Hip R: right side of torso bottom to top of upperLegR
			mkC(
				torso,
				upperLegR,
				0.98,
				undefined,
				{ x: 5 * figureScale, y: 25 * figureScale },
				{ x: 0, y: -15 * figureScale },
			),
			// Knee R
			mkC(
				upperLegR,
				lowerLegR,
				0.94,
				undefined,
				{ x: 0, y: 15 * figureScale },
				{ x: 0, y: -15 * figureScale },
			),
			// Cross-stability links hold shoulder/hip width and resist folding.
			mkC(upperArmL, upperArmR, 0.72),
			mkC(upperLegL, upperLegR, 0.72),
			mkC(lowerLegL, lowerLegR, 0.64),
			mkC(upperArmL, upperLegR, 0.48),
			mkC(upperArmR, upperLegL, 0.48),
		];

		const figureBodies = [
			head,
			torso,
			upperArmL,
			lowerArmL,
			upperArmR,
			lowerArmR,
			upperLegL,
			lowerLegL,
			upperLegR,
			lowerLegR,
		];
		Matter.World.add(engine.world, [...figureBodies, ...constraints]);
		figureRef.current = {
			head,
			torso,
			upperArmL,
			lowerArmL,
			upperArmR,
			lowerArmR,
			upperLegL,
			lowerLegL,
			upperLegR,
			lowerLegR,
		};

		// ── Mouse Constraint (drag head only) ────────────────────────────────────
		const mainCanvas = mainCanvasRef.current!;
		mainCanvas.style.touchAction = "none";
		const mouse = Matter.Mouse.create(mainCanvas);
		Matter.Mouse.setElement(mouse, mainCanvas);
		Matter.Mouse.setOffset(mouse, { x: 0, y: 0 });
		Matter.Mouse.setScale(mouse, { x: 1, y: 1 });
		const mc = Matter.MouseConstraint.create(engine, {
			mouse,
			constraint: {
				stiffness: 0.45,
				damping: 0.15,
				render: { visible: false },
			},
			collisionFilter: { category: 0x0008, mask: 0x0008 },
		});
		// Allow grabbing any figure part while keeping caffeine blocks/walls non-draggable.
		figureBodies.forEach((b) => {
			b.collisionFilter = figureCollisionFilter;
		});
		mc.collisionFilter = { category: 0x0008, mask: 0x0008 };
		Matter.World.add(engine.world, mc);
		mouseConstraintRef.current = mc;

		return () => {
			caffeineBlocksRef.current = [];
			pourStateRef.current.pendingBlocks = 0;
			staticBoundsRef.current = null;
			Matter.Engine.clear(engine);
			Matter.World.clear(engine.world, false);
			cancelAnimationFrame(rafRef.current);
			if (jitterIntervalRef.current) clearInterval(jitterIntervalRef.current);
			clearAscTimers();
		};
	}, [clearAscTimers]);

	// ── Jitter interval management ──────────────────────────────────────────────
	useEffect(() => {
		if (jitterIntervalRef.current) {
			clearInterval(jitterIntervalRef.current);
			jitterIntervalRef.current = null;
		}
		const endingNoEffects = ascStep === "dead";
		if (endingNoEffects) {
			setJitter({ x: 0, y: 0 });
			return;
		}
		const fx = computeEffects(caffeineLevel);
		if (fx.jitterFreq > 0) {
			const interval = Math.max(16, 1000 / fx.jitterFreq);
			jitterIntervalRef.current = setInterval(() => {
				const a = fx.jitterAmp;
				setJitter({
					x: (Math.random() - 0.5) * 2 * a,
					y: (Math.random() - 0.5) * 2 * a,
				});
			}, interval);
		} else {
			setJitter({ x: 0, y: 0 });
		}
		return () => {
			if (jitterIntervalRef.current) clearInterval(jitterIntervalRef.current);
		};
	}, [caffeineLevel, ascStep]);

	// ── Phase transitions ────────────────────────────────────────────────────────
	useEffect(() => {
		const p = getPhase(caffeineLevel);
		setPhase(p);
	}, [caffeineLevel]);

	useEffect(() => {
		const blackScreenActive = phase === "black";
		if (!blackScreenActive) {
			blackTransitionReadyRef.current = false;
			return;
		}

		// Flip readiness on the next frame so black is rendered before cleanup.
		const id = window.requestAnimationFrame(() => {
			blackTransitionReadyRef.current = true;
		});
		return () => {
			window.cancelAnimationFrame(id);
		};
	}, [phase]);

	// ── Render Loop ──────────────────────────────────────────────────────────────
	useEffect(() => {
		const mainCanvas = mainCanvasRef.current;
		if (!mainCanvas) return;

		const ctx = mainCanvas.getContext("2d")!;

		let lastTime = 0;

		function resize() {
			const { w, h } = getViewportSize();
			renderSizeRef.current = { w, h };
			mainCanvas!.width = w;
			mainCanvas!.height = h;

			const engine = engineRef.current;
			if (engine) {
				const oldBounds = staticBoundsRef.current;
				if (oldBounds) {
					Matter.World.remove(engine.world, Object.values(oldBounds));
				}
				const nextBounds = createStaticBounds(w, h);
				staticBoundsRef.current = nextBounds;
				Matter.World.add(engine.world, Object.values(nextBounds));
			}

			const mouse = mouseConstraintRef.current?.mouse;
			if (mouse) {
				Matter.Mouse.setElement(mouse, mainCanvas!);
				Matter.Mouse.setOffset(mouse, { x: 0, y: 0 });
				Matter.Mouse.setScale(mouse, { x: 1, y: 1 });
			}
		}
		resize();
		window.addEventListener("resize", resize);
		window.visualViewport?.addEventListener("resize", resize);

		function frame(ts: number) {
			rafRef.current = requestAnimationFrame(frame);
			if (lastTime === 0) {
				lastTime = ts;
			}
			const dt = Math.min(ts - lastTime, 34);
			lastTime = ts;
			if (!engineRef.current) return;

			const fig = figureRef.current;
			if (fig && ascStepRef.current !== "dead") {
				// Help forearms hang naturally so elbows can fold downward more easily.
				const elbowHangForce = 0.00036;
				Matter.Body.applyForce(fig.lowerArmL, fig.lowerArmL.position, {
					x: 0,
					y: elbowHangForce * fig.lowerArmL.mass,
				});
				Matter.Body.applyForce(fig.lowerArmR, fig.lowerArmR.position, {
					x: 0,
					y: elbowHangForce * fig.lowerArmR.mass,
				});
			}

			Matter.Engine.update(engineRef.current, dt);

			const { w, h } = renderSizeRef.current;
			const mg = caffeineLevelRef.current;
			const baseFx = computeEffects(mg);
			const endingNoEffects = ascStepRef.current === "dead";
			const fx = endingNoEffects
				? {
						...baseFx,
						blackOverlay: 0,
						whiteOverlay: 0,
						blur: 0,
						dvOffset: 0,
						chromatic: 0,
						jitterAmp: 0,
						jitterFreq: 0,
					}
				: baseFx;
			const pour = pourStateRef.current;
			const isEndingStage =
				ascStepRef.current === "dead" ||
				(getPhase(mg) === "black" && blackTransitionReadyRef.current);
			if (isEndingStage) {
				if (caffeineBlocksRef.current.length > 0) {
					for (const block of caffeineBlocksRef.current) {
						Matter.World.remove(engineRef.current.world, block.body);
					}
					caffeineBlocksRef.current = [];
				}
				pour.pendingBlocks = 0;
			} else if (pour.pendingBlocks > 0) {
				const spawns = Math.min(BLOCK_SPAWN_PER_FRAME, pour.pendingBlocks);
				for (let i = 0; i < spawns; i++) {
					const sourceX = w * 0.85 + Math.sin(ts * 0.006 + i * 0.4) * 10;
					const sourceY = h * 0.07;
					const block = makeCaffeineBlock(engineRef.current, sourceX, sourceY);
					caffeineBlocksRef.current.push(block);
				}
				pour.pendingBlocks -= spawns;
			}

			if (caffeineBlocksRef.current.length > MAX_ACTIVE_BLOCKS) {
				const overflow = caffeineBlocksRef.current.length - MAX_ACTIVE_BLOCKS;
				for (let i = 0; i < overflow; i++) {
					const old = caffeineBlocksRef.current.shift();
					if (old) {
						Matter.World.remove(engineRef.current.world, old.body);
					}
				}
			}

			// ── Main canvas: caffeine blocks + stick figure ────────────────────────
			ctx.clearRect(0, 0, w, h);
			ctx.save();
			ctx.globalCompositeOperation = "source-over";
			ctx.fillStyle = "rgba(92,61,38,0.42)";
			ctx.strokeStyle = "rgba(70,42,20,0.45)";
			ctx.lineWidth = 1;
			if (!isEndingStage) {
				for (const block of caffeineBlocksRef.current) {
					const radius = block.body.circleRadius;
					if (!radius) continue;
					ctx.beginPath();
					ctx.arc(
						block.body.position.x,
						block.body.position.y,
						radius,
						0,
						Math.PI * 2,
					);
					ctx.fill();
					ctx.stroke();
				}
			}
			ctx.restore();

			if (figureRef.current) {
				const deadMode =
					ascStepRef.current === "dead" || getPhase(mg) === "black";
				drawStickFigure(
					ctx,
					figureRef.current,
					fx.smileT,
					fx.smileBoost,
					deadMode,
				);
			}

			// ── Ghost canvas (double-vision: main canvas) ──────────────────────────
			const ghostCanvas = ghostCanvasRef.current;
			if (ghostCanvas) {
				ghostCanvas.width = w;
				ghostCanvas.height = h;
				const gCtx = ghostCanvas.getContext("2d")!;
				gCtx.clearRect(0, 0, w, h);
				if (fx.dvOffset > 0) {
					gCtx.drawImage(
						mainCanvas as HTMLCanvasElement,
						fx.dvOffset,
						fx.dvOffset * 0.3,
					);
				}
			}

			// ── Apply wrapper CSS effects ──────────────────────────────────────────
			const wrapper = wrapperRef.current;
			if (wrapper) {
				let filterStr = "";
				if (fx.blur > 0) filterStr += `blur(${fx.blur.toFixed(1)}px) `;
				if (fx.chromatic > 0) {
					const c = (fx.chromatic * 0.42).toFixed(1);
					filterStr += `drop-shadow(${c}px 0 0 rgba(255,34,34,0.42)) `;
					filterStr += `drop-shadow(-${c}px 0 0 rgba(0,120,255,0.42)) `;
				}
				wrapper.style.filter = filterStr || "none";
			}
		}

		rafRef.current = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(rafRef.current);
			window.removeEventListener("resize", resize);
			window.visualViewport?.removeEventListener("resize", resize);
		};
	}, []);

	// ── Caffeine Block Pouring ─────────────────────────────────────────────────
	const queuePour = useCallback((mg: number) => {
		const pour = pourStateRef.current;
		pour.pendingBlocks += Math.max(1, Math.round(mg / CAFFEINE_BLOCK_MG));
	}, []);

	const playDrinkClick = useCallback(() => {
		playFromPool(clickSoundPoolRef, "/click.wav", 0.3);
	}, [playFromPool]);

	const handleDrink = useCallback(
		(mg: number) => {
			if (phase === "black") return;
			playDrinkClick();
			setCaffeineLevel((prev) => {
				const next = prev + mg;
				caffeineLevelRef.current = next;
				return next;
			});
			queuePour(mg);
		},
		[phase, playDrinkClick, queuePour],
	);

	// ── Ascension handlers ────────────────────────────────────────────────────────
	const handleAscButton = useCallback(() => {
		if (ascStep === "idle") {
			clearAscTimers();
			setAscWhiteOverlay(0);
			setAscWhiteTransitionMs(600);
			setAscText("welcome");
			setAscStep("welcome");
			return;
		}

		if (ascStep === "welcome") {
			clearAscTimers();
			setAscText("ascended");
			setAscStep("ascended");
		}
	}, [ascStep, clearAscTimers]);

	const handleToWhere = useCallback(() => {
		if (ascStep !== "ascended") return;
		clearAscTimers();
		setAscStep("realm");
		const endingTransitionMs =
			REALM_LINE_MS + WHITEOUT_DURATION_MS + WHITEOUT_HOLD_MS;
		const prepAtMs = Math.max(0, endingTransitionMs - ENDING_SETTLE_BUFFER_MS);
		queueAscTimeout(() => {
			setAscStep("blinding");
			setAscWhiteTransitionMs(WHITEOUT_DURATION_MS);
			setAscWhiteOverlay(1);
		}, REALM_LINE_MS);
		queueAscTimeout(() => {
			clearCaffeineBlocks();
			placeFigureForEnding();
		}, prepAtMs);
		queueAscTimeout(
			() => {
				clearCaffeineBlocks();
				setAscStep("dead");
				setAscWhiteTransitionMs(0);
				setAscWhiteOverlay(0);
			},
			endingTransitionMs,
		);
	}, [
		ascStep,
		clearAscTimers,
		clearCaffeineBlocks,
		placeFigureForEnding,
		queueAscTimeout,
	]);

	const playSnap = useCallback(() => {
		playFromPool(snapSoundPoolRef, "/snap.wav", 0.1);
	}, [playFromPool]);

	const handleAscButtonWithSnap = useCallback(() => {
		playSnap();
		handleAscButton();
	}, [playSnap, handleAscButton]);

	const handleToWhereWithSnap = useCallback(() => {
		playSnap();
		handleToWhere();
	}, [playSnap, handleToWhere]);

	useEffect(() => {
		if (ascStep !== "dead") return;
		clearCaffeineBlocks();
	}, [ascStep, clearCaffeineBlocks]);

	// ── Effects for chromatic aberration on ghost ─────────────────────────────
	const isDead = ascStep === "dead";
	const baseFx = computeEffects(caffeineLevel);
	const endingNoEffects = ascStep === "dead";
	const fx = endingNoEffects
		? {
				...baseFx,
				blackOverlay: 0,
				whiteOverlay: 0,
				blur: 0,
				dvOffset: 0,
				chromatic: 0,
				jitterAmp: 0,
				jitterFreq: 0,
			}
		: baseFx;

	const overlayColor =
		fx.blackOverlay > 0
			? `rgba(0,0,0,${fx.blackOverlay})`
			: fx.whiteOverlay > 0
				? `rgba(255,255,255,${fx.whiteOverlay})`
				: "transparent";

	const ghostOpacity = fx.dvOffset > 0 ? clamp(0.2 + fx.chromatic / 90, 0.2, 0.55) : 0;
	const ghostTransform = `translate(${fx.dvOffset + jitter.x}px, ${fx.dvOffset * 0.3 + jitter.y}px)`;
	const chromaticStyle =
		fx.chromatic > 0
			? {
					filter: `drop-shadow(${fx.chromatic}px 0 0 rgba(255,0,0,0.8)) drop-shadow(-${fx.chromatic}px 0 0 rgba(0,90,255,0.8))`,
				}
			: {};
	const narrativeCopy = getNarrativeCopy(caffeineLevel);
	const handleButtonMouseEnter = useCallback(
		(e: MouseEvent<HTMLButtonElement>) => {
			e.currentTarget.style.background = BUTTON_BG_HOVER;
		},
		[],
	);
	const handleButtonMouseLeave = useCallback(
		(e: MouseEvent<HTMLButtonElement>) => {
			e.currentTarget.style.background = BUTTON_BG;
		},
		[],
	);

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				overflow: "hidden",
				background: "#faf6f0",
			}}
		>
			{/* Main wrapper (screen effects applied here) */}
			<div ref={wrapperRef} style={{ position: "absolute", inset: 0 }}>
				{/* Welcome text layer (placed behind canvases so liquid can occlude it) */}
				{phase !== "black" && (
					<div
						style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
					>
						<div
							style={{
								position: "absolute",
								top: "50%",
								left: "50%",
								transform: "translate(-50%, -50%)",
								textAlign: "center",
								pointerEvents: "none",
							}}
						>
							<div
								style={{
									fontSize: "clamp(3rem, 8vw, 6rem)",
									fontWeight: 900,
									color: "rgba(30,15,0,0.2)",
									letterSpacing: "-0.02em",
									lineHeight: 1,
									userSelect: "none",
								}}
							>
								{narrativeCopy.title}
							</div>
							<div
								style={{
									fontSize: "clamp(1rem, 2.5vw, 1.8rem)",
									fontWeight: 400,
									color: "rgba(30,15,0,0.15)",
									marginTop: "0.5rem",
									whiteSpace: "pre-line",
									userSelect: "none",
								}}
							>
								{narrativeCopy.subtitle}
							</div>
						</div>
					</div>
				)}

				{/* 2D canvas: caffeine blocks + stick figure (transparent bg) */}
				<canvas
					ref={mainCanvasRef}
					style={{
						position: "absolute",
						inset: 0,
						width: "100%",
						height: "100%",
						cursor: isDead ? "default" : "grab",
						pointerEvents: "auto",
					}}
				/>

				{/* Ghost canvas (double vision) */}
				<div
					ref={ghostRef}
					style={{
						position: "absolute",
						inset: 0,
						opacity: ghostOpacity,
						transform: ghostTransform,
						pointerEvents: "none",
						transition: "opacity 0.3s",
						...chromaticStyle,
					}}
				>
					<canvas
						ref={ghostCanvasRef}
						style={{
							position: "absolute",
							inset: 0,
							width: "100%",
							height: "100%",
							pointerEvents: "none",
						}}
					/>
				</div>

				{/* Brightness overlay */}
				<div
					style={{
						position: "absolute",
						inset: 0,
						background: overlayColor,
						pointerEvents: "none",
						transition: endingNoEffects
							? "none"
							: `background ${ascWhiteTransitionMs}ms ${ascStep === "blinding" ? "linear" : "ease-in-out"}`,
					}}
				/>

				{/* UI Overlay */}
				{phase !== "black" && (
					<div
						style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
					>
						{/* Caffeine counter — large, centered at top */}
						<div
							style={{
								position: "absolute",
								top: "1.25rem",
								left: "50%",
								transform: "translateX(-50%)",
								background: "rgba(250,239,225,0.82)",
								border: "1.5px solid rgba(92,58,34,0.5)",
								borderRadius: "999px",
								padding: "0.45rem 1.5rem",
								boxShadow: "0 8px 20px rgba(30,12,0,0.18)",
								display: "flex",
								alignItems: "baseline",
								gap: "0.35rem",
								whiteSpace: "nowrap",
								pointerEvents: "none",
							}}
						>
							<span
								style={{
									fontSize: "2.4rem",
									fontWeight: 800,
									fontFamily: "monospace",
									color: "rgba(40,18,4,0.95)",
									letterSpacing: "-0.03em",
								}}
							>
								{caffeineLevel}
							</span>
							<span
								style={{
									fontSize: "1.1rem",
									fontWeight: 600,
									color: "rgba(50,24,8,0.76)",
									fontFamily: "monospace",
									letterSpacing: "0.05em",
								}}
							>
								mg
							</span>
						</div>

						{/* Buttons (left side) */}
						<div
							style={{
								position: "absolute",
								left: "3vw",
								top: "50%",
								transform: "translateY(-50%)",
								display: "flex",
								flexDirection: "column",
								gap: "1rem",
								pointerEvents: "auto",
							}}
						>
							<button
								onClick={() => handleDrink(200)}
								onMouseEnter={handleButtonMouseEnter}
								onMouseLeave={handleButtonMouseLeave}
								style={BUTTON_STYLE}
								type="button"
							>
								<div style={{ fontWeight: 700, fontSize: "1.5rem" }}>
									Chug an Alani
								</div>
								<div style={{ opacity: 0.7, fontSize: "1.25rem" }}>
									+200 mg caffeine
								</div>
							</button>

							<button
								onClick={() => handleDrink(160)}
								onMouseEnter={handleButtonMouseEnter}
								onMouseLeave={handleButtonMouseLeave}
								style={BUTTON_STYLE}
								type="button"
							>
								<div style={{ fontWeight: 700, fontSize: "1.5rem" }}>
									Drink a Monster
								</div>
								<div style={{ opacity: 0.7, fontSize: "1.25rem" }}>
									+160 mg caffeine
								</div>
							</button>

							<button
								onClick={() => handleDrink(100)}
								onMouseEnter={handleButtonMouseEnter}
								onMouseLeave={handleButtonMouseLeave}
								style={BUTTON_STYLE}
								type="button"
							>
								<div style={{ fontWeight: 700, fontSize: "1.5rem" }}>
									Pop a Caffeine Pill
								</div>
								<div style={{ opacity: 0.7, fontSize: "1.25rem" }}>
									+100 mg caffeine
								</div>
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Ascension UI */}
			{phase === "black" && ascStep !== "dead" && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						background: "black",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						gap: "2rem",
					}}
				>
					{ascText === "welcome" && ascStep !== "ascended" && (
						<div
							style={{
								fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
								fontWeight: 900,
								color: "white",
								animation: "fadeIn 1.5s ease-in-out forwards",
								letterSpacing: "-0.02em",
							}}
						>
							Welcome.
						</div>
					)}

					{ascStep !== "ascended" &&
						ascStep !== "realm" &&
						ascStep !== "blinding" && (
							<button
								disabled={ascStep !== "idle" && ascStep !== "welcome"}
								key={ascStep}
								onClick={handleAscButtonWithSnap}
								style={{
									background: "transparent",
									border: "1.5px solid rgba(255,255,255,0.5)",
									borderRadius: "12px",
									padding: "12px 32px",
									color: "rgba(255,255,255,0.85)",
									cursor:
										ascStep === "idle" || ascStep === "welcome"
											? "pointer"
											: "default",
									fontSize: "1.1rem",
									transform: "scale(1)",
									opacity: 1,
									transition: "transform 0.15s, opacity 0.15s",
									animation:
										ascStep === "welcome"
											? "fadeIn 0.8s ease-in-out forwards"
											: "fadeIn 1.5s ease-in-out forwards",
								}}
								type="button"
							>
								{ascStep === "welcome" ? "Huh?" : "...?"}
							</button>
						)}

					{ascText === "ascended" && ascStep === "ascended" && (
						<div
							style={{
								fontSize: "clamp(2rem, 5vw, 3.5rem)",
								fontWeight: 900,
								color: "white",
								animation: "fadeIn 1.5s ease-in-out forwards",
								letterSpacing: "-0.02em",
							}}
						>
							You&apos;ve ascended.
						</div>
					)}

					{ascStep === "ascended" && (
						<button
							onClick={handleToWhereWithSnap}
							style={{
								background: "transparent",
								border: "1.5px solid rgba(255,255,255,0.5)",
								borderRadius: "12px",
								padding: "12px 32px",
								color: "rgba(255,255,255,0.85)",
								cursor: "pointer",
								fontSize: "1.1rem",
								animation: "fadeIn 1.5s ease-in-out forwards",
							}}
							type="button"
						>
							To where?
						</button>
					)}

					{(ascStep === "realm" || ascStep === "blinding") && (
						<div
							style={{
								fontSize: "clamp(1.8rem, 4.6vw, 3.2rem)",
								fontWeight: 900,
								color: "white",
								letterSpacing: "-0.02em",
								animation: "fadeIn 0.6s ease-in-out forwards",
							}}
						>
							The caffeine realm.
						</div>
					)}
				</div>
			)}

			{ascStep === "dead" && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						pointerEvents: "none",
					}}
				>
					<div
						style={{
							fontSize: "clamp(1.7rem, 5vw, 3rem)",
							fontWeight: 900,
							color: "rgba(35, 20, 10, 0.9)",
							textAlign: "center",
							letterSpacing: "-0.02em",
							textShadow: "0 2px 10px rgba(255,255,255,0.6)",
						}}
					>
						Huh, so there is a limit.
					</div>
				</div>
			)}

			{/* Whiteout overlay above all layers, including ascension UI */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					background: endingNoEffects
						? "rgba(255,255,255,0)"
						: `rgba(255,255,255,${ascWhiteOverlay})`,
					pointerEvents: "none",
					zIndex: 100,
					transition: endingNoEffects
						? "none"
						: `background ${ascWhiteTransitionMs}ms ${ascStep === "blinding" ? "linear" : "ease-in-out"}`,
				}}
			/>
		</div>
	);
}
