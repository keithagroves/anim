import { z } from "zod";

/** A number in px, or a theme token name ("sm", "md", "lg", ...). */
export const Size = z.union([z.number(), z.string()]);

const ALIGNS = [
  "center", "top", "bottom", "left", "right",
  "top-left", "top-right", "bottom-left", "bottom-right",
] as const;

/**
 * Where an object sits. Exactly one of: region | in | below | above | leftOf | rightOf | x+y.
 * A bare string is shorthand for { region }.
 */
export const PlacementObj = z
  .object({
    region: z.string().optional(),
    in: z.string().optional(),
    below: z.string().optional(),
    above: z.string().optional(),
    leftOf: z.string().optional(),
    rightOf: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    align: z.enum(ALIGNS).optional(),
    gap: Size.optional(),
    pad: Size.optional(),
    dx: z.number().optional(),
    dy: z.number().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const modes = ["region", "in", "below", "above", "leftOf", "rightOf"].filter((k) => (p as any)[k] !== undefined);
    const abs = p.x !== undefined || p.y !== undefined;
    if (modes.length + (abs ? 1 : 0) !== 1)
      ctx.addIssue({ code: "custom", message: "placement needs exactly one of region | in | below | above | leftOf | rightOf | x+y" });
    if (abs && (p.x === undefined || p.y === undefined))
      ctx.addIssue({ code: "custom", message: "absolute placement needs both x and y" });
  });
export const Placement = z.union([z.string(), PlacementObj]);
export type Placement = z.infer<typeof Placement>;

/** "obj", "obj.top" (center|top|bottom|left|right), or [x, y]. */
export const PointRef = z.union([z.string(), z.tuple([z.number(), z.number()])]);
export type PointRef = z.infer<typeof PointRef>;

export const OBJECT_TYPES = ["rect", "circle", "line", "arrow", "text", "path", "svg", "video", "group", "spotlight", "chip"] as const;

export const ObjDef = z
  .object({
    type: z.enum(OBJECT_TYPES),
    at: Placement.optional(),
    // group
    children: z.array(z.string()).optional(),
    layout: z
      .object({ dir: z.enum(["row", "col"]), gap: Size.optional(), align: z.enum(["start", "center", "end"]).optional() })
      .strict()
      .optional(),
    // geometry
    w: Size.optional(),
    h: Size.optional(),
    r: Size.optional(),
    radius: Size.optional(),
    from: PointRef.optional(),
    to: PointRef.optional(),
    /** spotlight: the object it frames (sized to it plus `pad`, and centred on it unless `at` is given). */
    on: z.string().optional(),
    /** spotlight: margin around `on` (default 24). chip: inner padding of the pill. */
    pad: Size.optional(),
    /** line/arrow: curve so the middle sits this many px off the straight line (positive = left of travel). */
    bend: z.number().optional(),
    d: z.string().optional(),
    svg: z.string().optional(),
    /** video: a clip file relative to the video folder (e.g. "clips/hero.webm"); played with the `play` preset. */
    src: z.string().optional(),
    viewBox: z.string().optional(),
    // text
    text: z.string().optional(),
    style: z.string().optional(),
    size: z.number().optional(),
    weight: z.number().optional(),
    anchor: z.enum(["start", "middle", "end"]).optional(),
    decimals: z.number().int().optional(),
    // paint
    fill: z.string().optional(),
    fillOpacity: z.number().optional(),
    stroke: z.string().optional(),
    strokeWidth: Size.optional(),
    dash: z.string().optional(),
    opacity: z.number().optional(),
    shadow: z.boolean().optional(),
    /** rect only: draw as a labelled region (dashed outline, `text` as a title above the top-left corner). */
    frame: z.boolean().optional(),
    /** rect only: colour of the `text` label (defaults to the theme text colour). */
    labelColor: z.string().optional(),
    value: z.number().optional(),
    layer: z.number().optional(),
    /** Painted outside the camera, like a caption over the lens: a `focus` or `drift` doesn't move or scale it (headlines in a muted cut, captions). Root objects only. */
    hud: z.boolean().optional(),
    /** Product UI: it only eases. Overshoot, springs, wobble and breathing on it are linted (`ui-bounce`). Video objects are UI. */
    ui: z.boolean().optional(),
  })
  .strict();
export type ObjDef = z.infer<typeof ObjDef>;

/** Animatable properties. Keys and the generic `to` preset may set any of these. */
export const PROP_NAMES = [
  "opacity", "scale", "rotate", "dx", "dy", "w", "h",
  "fill", "stroke", "strokeWidth", "fillOpacity", "draw", "reveal", "clip", "value", "time",
] as const;
export type PropName = (typeof PROP_NAMES)[number];

export const PropsPatch = z
  .object({
    opacity: z.number().optional(),
    scale: z.number().optional(),
    rotate: z.number().optional(),
    dx: z.number().optional(),
    dy: z.number().optional(),
    w: Size.optional(),
    h: Size.optional(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: Size.optional(),
    fillOpacity: z.number().optional(),
    draw: z.number().optional(),
    reveal: z.number().optional(),
    clip: z.number().optional(),
    value: z.number().optional(),
    /** video: playhead position in the clip, seconds. */
    time: z.number().optional(),
    /** Move the object to another placement (compiled to dx/dy). */
    at: Placement.optional(),
  })
  .strict();
export type PropsPatch = z.infer<typeof PropsPatch>;

export const Entry = z
  .object({
    id: z.string().optional(),
    /** An object id, a glob ("s1.c*"), or a list of ids/globs (staggered in list order). Optional for `clear` (defaults to every local object). */
    target: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    preset: z.string(),
    /**
     * Seconds from section start (negative pre-rolls the first section, so frame 0 already shows it),
     * or a time string: "cue:name", "start", "end", "<sectionId>", "<sectionId>.end", each with optional
     * "+0.5" / "-0.6" second offsets (e.g. "end-0.6", "cue:intro+0.2").
     */
    at: z.union([z.number(), z.string()]).optional(),
    after: z.string().optional(),
    with: z.string().optional(),
    gap: z.number().optional(),
    offset: z.number().optional(),
    /** Seconds, a timing token ("fast" | "base" | "slow"), "rest" (until the section ends; the scene, for through tracks) or "all" (until the scene ends). */
    dur: z.union([z.number(), z.string()]).optional(),
    stagger: z.number().optional(),
    ease: z.string().optional(),
    // preset parameters
    to: z.union([PropsPatch, Placement]).optional(),
    from: z.union([z.string(), PlacementObj]).optional(),
    distance: z.number().optional(),
    amount: z.number().optional(),
    cycles: z.number().optional(),
    color: z.string().optional(),
    /** play: clip second to start from (default: where the playhead is), and playback speed. */
    start: z.number().optional(),
    rate: z.number().optional(),
    /** ease "back": overshoot strength (default 1.70158; 1.4–1.9 for shapes, 1.5 for pills). */
    overshoot: z.number().optional(),
    /** pop: degrees it un-rotates from as it lands (e.g. -30). */
    spin: z.number().optional(),
    /** breathe / sway: seconds per cycle (default 3). */
    period: z.number().optional(),
    /** words-in / words-out / lines-in: seconds between words (or lines). */
    pace: z.number().optional(),
    /** words-in / words-out / lines-in / clear / creep: which side things come from or go to. */
    side: z.enum(["left", "right", "up", "down"]).optional(),
    /** to / move / fly-from: pull back this fraction of the move first (anticipation, e.g. 0.06). */
    anticipate: z.number().optional(),
    /** focus (camera): the object or placement to zoom onto; and how far (default: fit it, 1.6–2.4×). */
    on: z.union([z.string(), PlacementObj]).optional(),
    zoom: z.number().optional(),
  })
  .strict();
export type Entry = z.infer<typeof Entry>;

export const SectionFile = z
  .object({
    id: z.string(),
    objects: z.record(ObjDef).optional(),
    timeline: z.array(Entry),
  })
  .strict();
export type SectionFile = z.infer<typeof SectionFile>;

export const SceneFile = z
  .object({
    id: z.string(),
    stage: z.record(Placement).optional(),
    objects: z.record(ObjDef).default({}),
    keys: z.record(z.record(PropsPatch)).default({}),
    through: z.array(Entry).default([]),
    sections: z.array(z.object({
      id: z.string(), target: z.tuple([z.number(), z.number()]), brief: z.string(),
      /** The planned frame, drawn: paths in a 96 × 54 box in palette roles (sketch.ts, `anim plan`). */
      sketch: z.object({ bg: z.string().optional(), paths: z.array(z.string()) }).strict().optional(),
    }).strict()),
  })
  .strict();
export type SceneFile = z.infer<typeof SceneFile>;

export const ProjectFile = z
  .object({
    title: z.string().optional(),
    /** Video type from video-types/ (explainer, diagram, product-tour, …): how it's made and what it's for. */
    type: z.string().optional(),
    fps: z.number().default(30),
    size: z.tuple([z.number(), z.number()]).default([1920, 1080]),
    voice: z
      .object({
        engine: z.enum(["kokoro", "chatterbox"]).default("kokoro"),
        voice: z.string().default("af_heart"), // kokoro voice id
        speed: z.number().default(1), // kokoro only
        ref: z.string().optional(), // chatterbox: reference clip to clone (relative to the repo root)
        exaggeration: z.number().default(0.5), // chatterbox
        cfgWeight: z.number().default(0.5), // chatterbox
        seed: z.number().default(7), // chatterbox
      })
      .default({}),
    scenes: z.array(z.string()),
  })
  .strict();
export type ProjectFile = z.infer<typeof ProjectFile>;

export interface Words {
  duration: number;
  lead: number;
  tail: number;
  text: string;
  words: { text: string; start: number; end: number }[];
  cues: Record<string, number>;
}

// ---------- compiled (serializable, consumed by evaluate/paint) ----------

export interface Box { x: number; y: number; w: number; h: number } // x,y = center

export type Props = {
  opacity: number; scale: number; rotate: number; dx: number; dy: number; w: number; h: number;
  fill: string; stroke: string; strokeWidth: number; fillOpacity: number;
  draw: number; reveal: number; clip: number; value: number; time: number;
};

/** A video clip pre-extracted to numbered JPEG frames (see cli/clips.ts). */
export interface ClipInfo { url: string; frames: number; fps: number; w: number; h: number; duration: number }

export interface CObj {
  id: string;
  def: ObjDef;
  /** "scene" or the index of the owning section. */
  owner: "scene" | number;
  parent?: string;
  base: Props;
  /** Resolved line/arrow endpoints. */
  points?: [[number, number], [number, number]];
  font?: { family: string; size: number; weight: number };
  radius?: number;
  /** rect label colour (resolved). */
  labelFill?: string;
}

export interface CAnim {
  target: string;
  preset: string;
  start: number;
  dur: number;
  ease?: string;
  params: Record<string, any>;
  /** Index of the timeline entry this came from (stagger shares one). */
  entry: number;
}

export interface CScene {
  id: string;
  size: [number, number];
  fps: number;
  duration: number;
  theme: import("./theme.js").Theme;
  objects: Record<string, CObj>;
  /** Root ids in paint order; children are painted inside their group. */
  roots: string[];
  layout: Record<string, Box>;
  /** `placeholder`: the section file doesn't exist yet, so a name card stands in for it. */
  spans: { id: string; start: number; end: number; brief: string; placeholder?: boolean }[];
  /** Cumulative key state at the start of each section. */
  keysAt: Record<string, Partial<Props>>[];
  anims: CAnim[][];
  through: CAnim[];
  cues: Record<string, number>;
  words: Words["words"];
  audio?: string;
  /** Keyed by the `src` of video objects. */
  clips?: Record<string, ClipInfo>;
}

/** Per-word state for text animated word by word (words-in / words-out / lines-in). */
export interface WordFx {
  /** Visibility per unit (word, or line when `lines`), 0..1. */
  v: number[];
  /** Offset at visibility 0, px. */
  dx: number;
  dy: number;
  lines?: boolean;
}

export interface Frame {
  t: number;
  section: number;
  objects: Record<string, Props & { hidden?: boolean; words?: WordFx }>;
  camera: Props;
}
