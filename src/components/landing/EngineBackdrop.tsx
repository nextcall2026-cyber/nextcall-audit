/**
 * The landing page's engine — a technical illustration of a four-cylinder block,
 * drawn in SVG and animated entirely by CSS (see "LIVE ENGINE BACKDROP" in
 * globals.css).
 *
 * Deliberately drawn like an engineering drawing rather than a picture: hairline
 * strokes, steel gradients for volume, real trapezoid gear teeth, belt geometry
 * built from the actual pulley radii, and hairline leader lines with part names.
 * Server component — no state, no effects, all motion is CSS transforms.
 * Decorative, so it is hidden from assistive tech.
 *
 * Every rotation centre is passed inline in viewBox units. A bounding-box origin
 * makes a crank throw spin around its own middle instead of around the shaft.
 */

const CYLINDERS = [500, 620, 740, 860];
const CYCLE_SECONDS = 1.7;
/** Quarter of a cycle apart, the way a four-cylinder engine actually fires. */
const PHASE_SECONDS = CYCLE_SECONDS / 4;

const CRANK_Y = 440;
const BLOCK = { x: 430, y: 170, w: 500, h: 330 };
const BORE = { top: 190, bottom: 400, halfWidth: 38 };

/** Ink used across the drawing. Restrained on purpose. */
const LINE = "#2b3948";
const LINE_SOFT = "#223040";
const HAIR = "#1b2530";
const AMBER = "#f5a524";
const GREEN = "#2fd583";

/**
 * Trapezoid teeth around a pitch circle. Drawn as one path so the gear reads as
 * machined rather than as a circle with sticks poking out of it.
 */
function toothPath(cx: number, cy: number, radius: number, teeth: number, height: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (r: number, angle: number) =>
    `${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`;

  return Array.from({ length: teeth }, (_, index) => {
    const centre = index * step;
    const rootHalf = step * 0.38;
    const tipHalf = step * 0.18;
    return [
      `M ${at(radius, centre - rootHalf)}`,
      `L ${at(radius + height, centre - tipHalf)}`,
      `L ${at(radius + height, centre + tipHalf)}`,
      `L ${at(radius, centre + rootHalf)}`,
      "Z",
    ].join(" ");
  }).join(" ");
}

function Gear({
  cx,
  cy,
  radius,
  teeth,
  height,
  reverse = false,
  label,
}: {
  cx: number;
  cy: number;
  radius: number;
  teeth: number;
  height: number;
  reverse?: boolean;
  label?: string;
}) {
  const spokes = Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * Math.PI * 2;
    return (
      <line
        key={index}
        x1={cx + Math.cos(angle) * radius * 0.26}
        y1={cy + Math.sin(angle) * radius * 0.26}
        x2={cx + Math.cos(angle) * (radius - 8)}
        y2={cy + Math.sin(angle) * (radius - 8)}
        stroke={LINE_SOFT}
        strokeWidth="1"
      />
    );
  });

  return (
    <g>
      <g
        className={reverse ? "mc-gear-rev" : "mc-gear"}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        <path d={toothPath(cx, cy, radius, teeth, height)} fill="url(#eng-steel)" stroke={LINE} strokeWidth="1" />
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={LINE} strokeWidth="1.25" />
        {spokes}
        <circle cx={cx} cy={cy} r={radius * 0.3} fill="url(#eng-steel)" stroke={LINE} strokeWidth="1.25" />
        <circle cx={cx} cy={cy} r={radius * 0.13} fill="none" stroke={LINE_SOFT} strokeWidth="1" />
      </g>
      {/* hub axle stays still while the gear turns */}
      <circle cx={cx} cy={cy} r={radius * 0.09} fill={HAIR} stroke={LINE} strokeWidth="1" />
      {label && (
        <text x={cx} y={cy + radius + 22} textAnchor="middle" className="mc-eng-note">
          {label}
        </text>
      )}
    </g>
  );
}

function Gauge({ cx, cy, radius }: { cx: number; cy: number; radius: number }) {
  const ticks = Array.from({ length: 11 }, (_, index) => {
    const angle = (-220 + index * 8) * (Math.PI / 180);
    const long = index % 5 === 0;
    return (
      <line
        key={index}
        x1={cx + Math.sin(angle) * radius * 0.72}
        y1={cy - Math.cos(angle) * radius * 0.72}
        x2={cx + Math.sin(angle) * (long ? radius * 0.88 : radius * 0.8)}
        y2={cy - Math.cos(angle) * (long ? radius * 0.88 : radius * 0.8)}
        stroke={long ? LINE : LINE_SOFT}
        strokeWidth={long ? 1.5 : 1}
      />
    );
  });

  return (
    <g>
      <circle cx={cx} cy={cy} r={radius} fill="url(#eng-steel)" stroke={LINE} strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={radius - 6} fill="none" stroke={HAIR} strokeWidth="1" />
      {/* red line zone */}
      <path
        d={`M ${cx + Math.sin(-0.35) * radius * 0.7} ${cy - Math.cos(-0.35) * radius * 0.7} A ${radius * 0.7} ${radius * 0.7} 0 0 1 ${cx + Math.sin(0.35) * radius * 0.7} ${cy - Math.cos(0.35) * radius * 0.7}`}
        fill="none"
        stroke="rgba(255,95,86,0.55)"
        strokeWidth="2.5"
      />
      {ticks}
      <line
        x1={cx}
        y1={cy + 8}
        x2={cx}
        y2={cy - radius * 0.66}
        stroke={AMBER}
        strokeWidth="1.5"
        className="mc-eng-needle"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} r={3.5} fill="#0c1116" stroke={AMBER} strokeWidth="1.5" />
    </g>
  );
}

/** Hairline leader line plus the part name, the way a drawing labels a part. */
function Callout({
  x,
  y,
  toX,
  toY,
  children,
  anchor = "start",
}: {
  x: number;
  y: number;
  toX: number;
  toY: number;
  children: React.ReactNode;
  anchor?: "start" | "end";
}) {
  const elbowX = anchor === "start" ? x - 10 : x + 10;
  return (
    <g>
      <path
        d={`M ${x} ${y - 4} H ${elbowX} L ${toX} ${toY}`}
        fill="none"
        stroke={LINE}
        strokeWidth="0.9"
      />
      <circle cx={toX} cy={toY} r="2.2" fill={AMBER} />
      <text x={x} y={y} textAnchor={anchor} className="mc-eng-note mc-eng-note-key">
        {children}
      </text>
    </g>
  );
}

export default function EngineBackdrop() {
  return (
    <div className="mc-eng-mask h-full w-full" aria-hidden="true">
      <svg
        viewBox="0 0 1400 700"
        className="mc-eng-drift h-full w-full"
        /* "meet", not "slice": slice scales a wide viewBox to COVER a tall page
           and crops the sides, which cut the gears, belt and gauges clean off.
           meet keeps the whole drawing in frame; the radial mask hides the
           letterboxing. */
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="eng-steel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b2634" />
            <stop offset="55%" stopColor="#111922" />
            <stop offset="100%" stopColor="#0b1016" />
          </linearGradient>
          <linearGradient id="eng-amber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245,165,36,0.5)" />
            <stop offset="100%" stopColor="rgba(245,165,36,0.08)" />
          </linearGradient>
          <linearGradient id="eng-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245,165,36,0.16)" />
            <stop offset="100%" stopColor="rgba(245,165,36,0)" />
          </linearGradient>
          <radialGradient id="eng-heat" cx="50%" cy="30%" r="62%">
            <stop offset="0%" stopColor="rgba(245,165,36,0.1)" />
            <stop offset="100%" stopColor="rgba(245,165,36,0)" />
          </radialGradient>
        </defs>

        <rect x="330" y="60" width="700" height="560" fill="url(#eng-heat)" />

        {/* ---------- intake rail with four drops ---------- */}
        <path d={`M ${BLOCK.x - 30} 120 H ${BLOCK.x + BLOCK.w + 30}`} fill="none" stroke="url(#eng-steel)" strokeWidth="13" strokeLinecap="round" />
        <path d={`M ${BLOCK.x - 30} 120 H ${BLOCK.x + BLOCK.w + 30}`} fill="none" stroke={LINE} strokeWidth="1" />
        <path
          d={`M ${BLOCK.x - 20} 120 H ${BLOCK.x + BLOCK.w + 20}`}
          fill="none"
          stroke={AMBER}
          strokeWidth="1.5"
          strokeDasharray="10 26"
          className="mc-eng-rail"
          opacity="0.6"
        />
        {CYLINDERS.map((cx) => (
          <g key={`drop-${cx}`}>
            <path d={`M ${cx} 126 V ${BORE.top}`} fill="none" stroke={LINE} strokeWidth="7" />
            <path d={`M ${cx} 126 V ${BORE.top}`} fill="none" stroke={LINE_SOFT} strokeWidth="1" />
          </g>
        ))}

        {/* ---------- exhaust run ---------- */}
        <path d={`M ${BLOCK.x - 20} 545 H ${BLOCK.x + BLOCK.w + 20}`} fill="none" stroke="url(#eng-steel)" strokeWidth="11" strokeLinecap="round" />
        <path d={`M ${BLOCK.x - 20} 545 H ${BLOCK.x + BLOCK.w + 20}`} fill="none" stroke={LINE} strokeWidth="1" />
        <path
          d={`M ${BLOCK.x - 10} 545 H ${BLOCK.x + BLOCK.w + 10}`}
          fill="none"
          stroke="#ff5f56"
          strokeWidth="1.5"
          strokeDasharray="8 30"
          className="mc-eng-rail"
          opacity="0.4"
          style={{ animationDirection: "reverse" }}
        />

        {/* ---------- engine block ---------- */}
        <rect x={BLOCK.x} y={BLOCK.y} width={BLOCK.w} height={BLOCK.h} rx="6" fill="url(#eng-steel)" stroke={LINE} strokeWidth="1.5" />
        <rect x={BLOCK.x + 4} y={BLOCK.y + 4} width={BLOCK.w - 8} height={BLOCK.h - 8} rx="4" fill="none" stroke={HAIR} strokeWidth="1" />
        {/* deck face */}
        <rect x={BLOCK.x - 12} y={BLOCK.y - 16} width={BLOCK.w + 24} height="16" rx="3" fill="url(#eng-glow)" stroke={LINE} strokeWidth="1.25" />
        {Array.from({ length: 9 }, (_, i) => (
          <g key={`bolt-${i}`}>
            <circle cx={BLOCK.x + 8 + i * ((BLOCK.w - 16) / 8)} cy={BLOCK.y - 8} r="3.4" fill="#0b1016" stroke={LINE_SOFT} strokeWidth="1" />
            <line
              x1={BLOCK.x + 4 + i * ((BLOCK.w - 16) / 8)}
              y1={BLOCK.y - 8}
              x2={BLOCK.x + 12 + i * ((BLOCK.w - 16) / 8)}
              y2={BLOCK.y - 8}
              stroke={LINE_SOFT}
              strokeWidth="1"
            />
          </g>
        ))}

        {/* ---------- cylinders, pistons, rods ---------- */}
        {CYLINDERS.map((cx, index) => (
          <g key={`cyl-${cx}`}>
            <path
              d={`M ${cx - BORE.halfWidth} ${BORE.top} V ${BORE.bottom} M ${cx + BORE.halfWidth} ${BORE.top} V ${BORE.bottom}`}
              fill="none"
              stroke={LINE}
              strokeWidth="1.5"
            />
            <path
              d={`M ${cx - BORE.halfWidth + 8} ${BORE.top + 10} V ${BORE.bottom} M ${cx + BORE.halfWidth - 8} ${BORE.top + 10} V ${BORE.bottom}`}
              fill="none"
              stroke={HAIR}
              strokeWidth="1"
            />

            {/* spark at the top of the stroke */}
            <circle cx={cx} cy={BORE.top - 8} r="4" fill={AMBER} className="mc-eng-flash" style={{ animationDelay: `${-index * PHASE_SECONDS}s` }} />

            <g
              className="mc-eng-piston"
              style={{ animationDelay: `${-index * PHASE_SECONDS}s`, animationDuration: `${CYCLE_SECONDS}s` }}
            >
              {/* connecting rod: tapered body, two ends */}
              <path
                d={`M ${cx - 7} 336 L ${cx + 7} 336 L ${cx + 15} ${CRANK_Y - 16} L ${cx - 15} ${CRANK_Y - 16} Z`}
                fill="url(#eng-steel)"
                stroke={LINE}
                strokeWidth="1.25"
              />
              {/* piston crown with ring lands */}
              <rect x={cx - 30} y={205} width="60" height="54" rx="3" fill="url(#eng-amber)" stroke={AMBER} strokeWidth="1.5" />
              <rect x={cx - 30} y="205" width="60" height="11" fill="none" stroke={AMBER} strokeWidth="0.9" opacity="0.75" />
              <rect x={cx - 30} y="218" width="60" height="5" fill="none" stroke={AMBER} strokeWidth="0.9" opacity="0.6" />
              <rect x={cx - 30} y="226" width="60" height="5" fill="none" stroke={AMBER} strokeWidth="0.9" opacity="0.45" />
              <circle cx={cx} cy="250" r="7" fill="#0b1016" stroke={AMBER} strokeWidth="1.5" />
            </g>
          </g>
        ))}

        {/* ---------- crankshaft ---------- */}
        <path
          d={`M ${BLOCK.x + 20} ${CRANK_Y} H ${BLOCK.x + BLOCK.w - 20}`}
          fill="none"
          stroke="url(#eng-steel)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d={`M ${BLOCK.x + 20} ${CRANK_Y} H ${BLOCK.x + BLOCK.w - 20}`}
          fill="none"
          stroke={LINE}
          strokeWidth="1"
        />
        {CYLINDERS.map((cx, index) => (
          <g
            key={`throw-${cx}`}
            className="mc-eng-crank"
            style={{
              transformOrigin: `${cx}px ${CRANK_Y}px`,
              animationDelay: `${-index * PHASE_SECONDS}s`,
              animationDuration: `${CYCLE_SECONDS}s`,
            }}
          >
            <path
              d={`M ${cx - 26} ${CRANK_Y} A 26 26 0 0 1 ${cx + 26} ${CRANK_Y} Z`}
              fill="url(#eng-amber)"
              stroke={AMBER}
              strokeWidth="1.25"
            />
            <circle cx={cx} cy={CRANK_Y} r="26" fill="none" stroke={LINE} strokeWidth="1" />
            <circle cx={cx} cy={CRANK_Y - 20} r="8" fill="#0b1016" stroke={AMBER} strokeWidth="1.5" />
            {/* main journal stays put while the throw orbits */}
            <circle cx={cx} cy={CRANK_Y} r="4" fill="none" stroke={LINE_SOFT} strokeWidth="1" />
          </g>
        ))}

        {/* ---------- timing gears ---------- */}
        <Gear cx={190} cy={300} radius={64} teeth={24} height={10} />
        <Gear cx={265} cy={375} radius={42} teeth={16} height={8} reverse />

        {/* ---------- belt drive: path built from the two pulley radii ---------- */}
        {(() => {
          const beltX = 1120;
          const topY = 250;
          const bottomY = 440;
          const topR = 56;
          const bottomR = 36;
          const loop = `M ${beltX - topR} ${topY} A ${topR} ${topR} 0 0 1 ${beltX + topR} ${topY} L ${beltX + bottomR} ${bottomY} A ${bottomR} ${bottomR} 0 0 1 ${beltX - bottomR} ${bottomY} Z`;
          return (
            <g>
              <circle cx={beltX} cy={topY} r={topR} fill="url(#eng-steel)" stroke={LINE} strokeWidth="1.5" />
              <circle cx={beltX} cy={topY} r={topR - 10} fill="none" stroke={HAIR} strokeWidth="1" />
              <circle cx={beltX} cy={bottomY} r={bottomR} fill="url(#eng-steel)" stroke={LINE} strokeWidth="1.5" />
              <circle cx={beltX} cy={bottomY} r={bottomR - 8} fill="none" stroke={HAIR} strokeWidth="1" />
              <path d={loop} fill="none" stroke={LINE} strokeWidth="5" />
              <path d={loop} fill="none" stroke="#8fa1b3" strokeWidth="1.75" strokeDasharray="10 20" className="mc-eng-belt" opacity="0.8" />
              <circle cx={beltX} cy={topY} r="6" fill="#0b1016" stroke={LINE_SOFT} strokeWidth="1" />
              <circle cx={beltX} cy={bottomY} r="5" fill="#0b1016" stroke={LINE_SOFT} strokeWidth="1" />
            </g>
          );
        })()}

        {/* ---------- coolant circuit ---------- */}
        <path d={`M ${BLOCK.x} 330 C 320 330 285 430 285 500 L 285 545`} fill="none" stroke="url(#eng-steel)" strokeWidth="9" strokeLinecap="round" />
        <path d={`M ${BLOCK.x} 330 C 320 330 285 430 285 500 L 285 545`} fill="none" stroke={LINE} strokeWidth="1" />
        <path
          d={`M ${BLOCK.x} 330 C 320 330 285 430 285 500 L 285 545`}
          fill="none"
          stroke={GREEN}
          strokeWidth="1.5"
          strokeDasharray="7 21"
          className="mc-eng-rail"
          opacity="0.55"
        />

        {/* ---------- gauges ---------- */}
        <Gauge cx={200} cy={600} radius={46} />
        <Gauge cx={1210} cy={600} radius={46} />

        {/* ---------- part callouts ---------- */}
        <Callout x={520} y={96} toX={560} toY={BORE.top}>cylinder liner ×4</Callout>
        <Callout x={1000} y={250} toX={890} toY={232}>piston + rod</Callout>
        <Callout x={1000} y={516} toX={900} toY={CRANK_Y}>crankshaft</Callout>
        <Callout x={70} y={214} toX={180} toY={278} anchor="start">timing gears</Callout>
        <Callout x={1240} y={176} toX={1168} toY={228}>belt drive</Callout>
        <Callout x={70} y={620} toX={168} toY={600}>coolant</Callout>
      </svg>
    </div>
  );
}