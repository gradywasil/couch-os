import React from 'react';
import { MiniGameMeta } from './miniGamesRegistry';

interface CartridgeArtworkProps {
  game: MiniGameMeta;
  compact?: boolean;
  variant?: 'tile' | 'hero' | 'compact';
  className?: string;
  /** Picture only: no frame hairline, glass or sheen (the host draws its own CRT glass). */
  bare?: boolean;
}

function renderArtworkScene(id: string, accent: string, uid: string): React.ReactNode {
  switch (id) {
    case 'neon-arena':
      return (
        <g>
          {/* Pinball bumpers */}
          <circle cx="88" cy="48" r="22" fill={`${accent}22`} stroke={accent} strokeWidth="2.5" />
          <circle cx="88" cy="48" r="11" fill={accent} opacity="0.85" />
          <circle cx="232" cy="48" r="22" fill="#38bdf822" stroke="#38bdf8" strokeWidth="2.5" />
          <circle cx="232" cy="48" r="11" fill="#38bdf8" opacity="0.85" />
          {/* Golden 30pt center star */}
          <polygon
            points="160,18 167,38 188,38 171,50 177,70 160,58 143,70 149,50 132,38 153,38"
            fill="#facc15"
            stroke="#fff7cc"
            strokeWidth="1.5"
          />
          {/* Dash streak & orb */}
          <path d="M 30 72 Q 90 66 135 50" stroke="#2ee59d" strokeWidth="3" strokeDasharray="6 4" fill="none" opacity="0.8" />
          <circle cx="135" cy="50" r="7" fill="#2ee59d" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="196" cy="28" r="6" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
        </g>
      );

    case 'hyper-pong':
      return (
        <g>
          {/* Corner bumpers */}
          <circle cx="38" cy="14" r="7" fill={accent} opacity="0.5" />
          <circle cx="282" cy="14" r="7" fill={accent} opacity="0.5" />
          <circle cx="38" cy="82" r="7" fill={accent} opacity="0.5" />
          <circle cx="282" cy="82" r="7" fill={accent} opacity="0.5" />
          {/* 4-wall paddles */}
          <rect x="44" y="28" width="7" height="38" rx="3.5" fill="#38bdf8" />
          <rect x="269" y="34" width="7" height="38" rx="3.5" fill="#fb7185" />
          <rect x="132" y="10" width="52" height="6" rx="3" fill="#4ade80" />
          <rect x="148" y="80" width="52" height="6" rx="3" fill="#facc15" />
          {/* Comet ball trail */}
          <line x1="88" y1="64" x2="184" y2="38" stroke={`url(#g-${uid})`} strokeWidth="8" strokeLinecap="round" opacity="0.65" />
          <circle cx="188" cy="37" r="7" fill="#ffffff" stroke={accent} strokeWidth="2.5" />
          <line x1="160" y1="16" x2="160" y2="80" stroke="rgba(255,255,255,0.12)" strokeDasharray="4 5" strokeWidth="1.5" />
        </g>
      );

    case 'laser-cycle':
      return (
        <g>
          {/* Orthogonal neon light trails */}
          <polyline points="20,70 110,70 110,28 190,28" fill="none" stroke="#2ee59d" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="190" cy="28" r="5" fill="#ffffff" stroke="#2ee59d" strokeWidth="2" />
          <polyline points="295,24 220,24 220,66 138,66" fill="none" stroke="#ff6b2b" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="138" cy="66" r="5" fill="#ffffff" stroke="#ff6b2b" strokeWidth="2" />
          <polyline points="60,16 60,48 164,48" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinejoin="round" opacity="0.8" />
          <circle cx="164" cy="48" r="4" fill="#ffffff" stroke="#38bdf8" strokeWidth="1.5" />
          {/* Derez burst */}
          <circle cx="220" cy="48" r="10" fill="none" stroke="#facc15" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>
      );

    case 'sumo-ring':
      return (
        <g>
          {/* Concentric cyber dojo rings */}
          <ellipse cx="160" cy="52" rx="92" ry="38" fill="none" stroke={accent} strokeWidth="2" strokeDasharray="6 4" opacity="0.45" />
          <ellipse cx="160" cy="52" rx="68" ry="29" fill={`${accent}14`} stroke={accent} strokeWidth="3" />
          <ellipse cx="160" cy="52" rx="34" ry="15" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
          {/* Clashing fighters */}
          <circle cx="136" cy="50" r="13" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          <circle cx="182" cy="50" r="13" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
          {/* Impact sparks */}
          <path d="M159,34 L161,44 M159,66 L161,56 M148,40 L154,46 M170,60 L164,54" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      );

    case 'meteor-dodge':
      return (
        <g>
          {/* Comets with fire tails */}
          <line x1="28" y1="12" x2="108" y2="50" stroke="#facc15" strokeWidth="7" strokeLinecap="round" opacity="0.3" />
          <line x1="42" y1="18" x2="108" y2="50" stroke="#ff6b2b" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="108" cy="50" r="10" fill="#ff6b2b" stroke="#facc15" strokeWidth="2" />

          <line x1="150" y1="6" x2="236" y2="42" stroke="#facc15" strokeWidth="9" strokeLinecap="round" opacity="0.28" />
          <line x1="170" y1="14" x2="236" y2="42" stroke="#ff6b2b" strokeWidth="4" strokeLinecap="round" />
          <circle cx="236" cy="42" r="12" fill="#facc15" stroke="#ffffff" strokeWidth="2" />

          {/* Shielded player blinking away */}
          <circle cx="160" cy="68" r="14" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="5 4" />
          <polygon points="160,57 169,74 160,70 151,74" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="140" cy="74" r="4" fill="#38bdf8" opacity="0.35" />
          <circle cx="126" cy="78" r="3" fill="#38bdf8" opacity="0.2" />
        </g>
      );

    case 'turbo-circuit':
      return (
        <g>
          {/* Racing oval */}
          <rect x="44" y="16" width="232" height="64" rx="32" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="20" />
          <rect x="44" y="16" width="232" height="64" rx="32" fill="none" stroke={accent} strokeWidth="2" strokeDasharray="8 6" />
          {/* Checkered stripe */}
          <g transform="translate(156, 6)">
            <rect x="0" y="0" width="5" height="5" fill="#ffffff" />
            <rect x="5" y="5" width="5" height="5" fill="#ffffff" />
            <rect x="0" y="10" width="5" height="5" fill="#ffffff" />
            <rect x="5" y="15" width="5" height="5" fill="#ffffff" />
          </g>
          {/* Chevron boost pads */}
          <polyline points="200,74 208,80 200,86" fill="none" stroke="#2ee59d" strokeWidth="2.5" />
          <polyline points="210,74 218,80 210,86" fill="none" stroke="#2ee59d" strokeWidth="2.5" />
          {/* Micro karts */}
          <rect x="116" y="11" width="16" height="9" rx="3" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.2" />
          <rect x="142" y="75" width="16" height="9" rx="3" fill="#fb7185" stroke="#ffffff" strokeWidth="1.2" />
          <rect x="86" y="76" width="16" height="9" rx="3" fill="#facc15" stroke="#ffffff" strokeWidth="1.2" />
        </g>
      );

    case 'coin-rush':
      return (
        <g>
          {/* Neon platforms */}
          <rect x="34" y="72" width="84" height="7" rx="3.5" fill="#38bdf8" opacity="0.8" />
          <rect x="122" y="48" width="76" height="7" rx="3.5" fill={accent} />
          <rect x="208" y="68" width="80" height="7" rx="3.5" fill="#2ee59d" opacity="0.8" />
          {/* Mega 25pt diamond gem */}
          <polygon points="160,12 174,26 160,40 146,26" fill="#facc15" stroke="#ffffff" strokeWidth="1.8" />
          {/* Coins */}
          <circle cx="76" cy="54" r="7" fill="#facc15" stroke="#fff7cc" strokeWidth="1.5" />
          <circle cx="248" cy="50" r="7" fill="#facc15" stroke="#fff7cc" strokeWidth="1.5" />
          {/* Jumping runner */}
          <circle cx="116" cy="34" r="8" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
          <path d="M 88 66 Q 100 34 114 34" fill="none" stroke="#fb7185" strokeWidth="2" strokeDasharray="3 3" opacity="0.7" />
        </g>
      );

    case 'tank-duel':
      return (
        <g>
          {/* Cover walls */}
          <rect x="148" y="20" width="24" height="10" rx="2" fill="rgba(255,255,255,0.22)" stroke={accent} strokeWidth="1.2" />
          <rect x="148" y="66" width="24" height="10" rx="2" fill="rgba(255,255,255,0.22)" stroke={accent} strokeWidth="1.2" />
          {/* Left tank */}
          <rect x="52" y="42" width="26" height="20" rx="4" fill="#4ade80" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="72" y1="52" x2="90" y2="44" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          {/* Right tank */}
          <rect x="242" y="36" width="26" height="20" rx="4" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="248" y1="46" x2="230" y2="52" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          {/* Bouncing plasma ricochet */}
          <polyline points="92,43 160,12 224,44" fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="5 4" />
          <circle cx="160" cy="12" r="5" fill="#facc15" />
          <circle cx="192" cy="28" r="5" fill="#ffffff" stroke="#4ade80" strokeWidth="2" />
        </g>
      );

    case 'space-blasters':
      return (
        <g>
          {/* Starfield dots */}
          <circle cx="50" cy="20" r="1.5" fill="#fff" opacity="0.5" />
          <circle cx="120" cy="76" r="1.5" fill="#fff" opacity="0.4" />
          <circle cx="205" cy="16" r="2" fill="#38bdf8" opacity="0.7" />
          {/* Starfighter */}
          <polygon points="82,48 48,32 56,48 48,64" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.6" />
          {/* Twin lasers + spread */}
          <line x1="86" y1="42" x2="188" y2="42" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
          <line x1="86" y1="54" x2="188" y2="54" stroke="#2ee59d" strokeWidth="3" strokeLinecap="round" />
          <line x1="86" y1="48" x2="178" y2="26" stroke="#facc15" strokeWidth="2" strokeDasharray="6 4" />
          <line x1="86" y1="48" x2="178" y2="70" stroke="#facc15" strokeWidth="2" strokeDasharray="6 4" />
          {/* Enemy cruiser */}
          <polygon points="212,48 258,22 276,48 258,74" fill="#fb7185" opacity="0.85" stroke="#ffffff" strokeWidth="1.8" />
          <circle cx="246" cy="48" r="8" fill="#facc15" />
        </g>
      );

    case 'color-turf':
      return (
        <g>
          {/* Paint splatters */}
          <circle cx="96" cy="46" r="24" fill="#c084fc" opacity="0.72" />
          <circle cx="72" cy="28" r="9" fill="#c084fc" opacity="0.72" />
          <circle cx="118" cy="70" r="8" fill="#c084fc" opacity="0.72" />

          <circle cx="164" cy="52" r="26" fill="#38bdf8" opacity="0.75" />
          <circle cx="144" cy="24" r="10" fill="#38bdf8" opacity="0.75" />

          <circle cx="224" cy="44" r="22" fill="#2ee59d" opacity="0.75" />
          <circle cx="248" cy="68" r="9" fill="#ff6b2b" opacity="0.85" />
          <circle cx="192" cy="72" r="12" fill="#ff6b2b" opacity="0.82" />
          {/* Splash ring */}
          <circle cx="164" cy="52" r="34" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeDasharray="7 5" opacity="0.65" />
        </g>
      );

    case 'hot-potato':
      return (
        <g>
          {/* Danger shockwaves */}
          <circle cx="160" cy="52" r="38" fill="none" stroke="#fb7185" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.45" />
          <circle cx="160" cy="52" r="28" fill="none" stroke="#ff6b2b" strokeWidth="2" opacity="0.7" />
          {/* Cyber bomb body */}
          <circle cx="160" cy="52" r="19" fill="#1b1f29" stroke="#fb7185" strokeWidth="3" />
          <circle cx="160" cy="52" r="9" fill="#fb7185" />
          {/* Fuse + spark */}
          <path d="M 166 34 Q 178 16 194 20" fill="none" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
          <polygon points="196,12 199,19 206,20 199,23 196,30 193,23 186,20 193,19" fill="#facc15" />
          {/* Chasing runners */}
          <circle cx="88" cy="56" r="9" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="234" cy="56" r="9" fill="#4ade80" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'air-hockey':
      return (
        <g>
          {/* Rink markings */}
          <rect x="34" y="14" width="252" height="68" rx="14" fill="none" stroke="#2ee59d" strokeWidth="2" opacity="0.55" />
          <line x1="160" y1="14" x2="160" y2="82" stroke="#2ee59d" strokeWidth="1.5" opacity="0.4" />
          <circle cx="160" cy="48" r="18" fill="none" stroke="#2ee59d" strokeWidth="1.5" opacity="0.45" />
          {/* Strikers */}
          <circle cx="76" cy="48" r="13" fill="#38bdf8" stroke="#ffffff" strokeWidth="2.2" />
          <circle cx="76" cy="48" r="5" fill="#0b0d12" />
          <circle cx="244" cy="48" r="13" fill="#fb7185" stroke="#ffffff" strokeWidth="2.2" />
          <circle cx="244" cy="48" r="5" fill="#0b0d12" />
          {/* Glowing puck with rebound trail */}
          <polyline points="92,48 158,20 206,56" fill="none" stroke="#2ee59d" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
          <circle cx="206" cy="56" r="7" fill="#ffffff" stroke="#2ee59d" strokeWidth="2.5" />
        </g>
      );

    case 'snake-battle':
      return (
        <g>
          {/* Segmented neon green snake */}
          <path d="M 42 66 Q 76 66 86 44 T 144 36 T 192 52" fill="none" stroke="#4ade80" strokeWidth="11" strokeLinecap="round" />
          <circle cx="195" cy="52" r="7" fill="#ffffff" stroke="#4ade80" strokeWidth="2.5" />
          {/* Rival cyan snake */}
          <path d="M 278 26 Q 240 24 228 54 T 164 74" fill="none" stroke="#38bdf8" strokeWidth="9" strokeLinecap="round" opacity="0.85" />
          <circle cx="162" cy="74" r="6" fill="#ffffff" stroke="#38bdf8" strokeWidth="2" />
          {/* Energy orbs */}
          <circle cx="230" cy="58" r="6" fill="#facc15" />
          <circle cx="122" cy="64" r="5" fill="#fb7185" />
          <circle cx="94" cy="24" r="5" fill="#facc15" />
        </g>
      );

    case 'quick-draw':
      return (
        <g>
          {/* Cyber western sunset */}
          <circle cx="160" cy="62" r="34" fill="#ff6b2b" opacity="0.35" />
          <circle cx="160" cy="62" r="22" fill="#facc15" opacity="0.6" />
          <line x1="20" y1="68" x2="300" y2="68" stroke="#facc15" strokeWidth="2" />
          {/* Crosshairs left & right */}
          <circle cx="84" cy="46" r="14" fill="none" stroke="#38bdf8" strokeWidth="2" />
          <line x1="84" y1="26" x2="84" y2="66" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="64" y1="46" x2="104" y2="46" stroke="#38bdf8" strokeWidth="1.5" />

          <circle cx="236" cy="46" r="14" fill="none" stroke="#fb7185" strokeWidth="2" />
          <line x1="236" y1="26" x2="236" y2="66" stroke="#fb7185" strokeWidth="1.5" />
          <line x1="216" y1="46" x2="256" y2="46" stroke="#fb7185" strokeWidth="1.5" />
          {/* Center lightning draw flash */}
          <polyline points="164,12 152,44 166,44 156,76" fill="none" stroke="#2ee59d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );

    case 'brick-smash':
      return (
        <g>
          {/* Brick rows */}
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <rect key={`r1-${c}`} x={44 + c * 39} y="14" width="34" height="9" rx="2" fill="#e2e8f0" opacity="0.85" />
          ))}
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <rect
              key={`r2-${c}`}
              x={44 + c * 39}
              y="27"
              width="34"
              height="9"
              rx="2"
              fill={c % 2 === 0 ? '#38bdf8' : '#ff6b2b'}
              opacity={c === 3 ? 0.15 : 0.9}
            />
          ))}
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <rect
              key={`r3-${c}`}
              x={44 + c * 39}
              y="40"
              width="34"
              height="9"
              rx="2"
              fill={c % 2 === 0 ? '#2ee59d' : '#facc15'}
              opacity={c === 2 || c === 3 ? 0.12 : 0.85}
            />
          ))}
          {/* Ricochet ball & paddles */}
          <polyline points="130,78 168,38 198,64" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="4 4" opacity="0.6" />
          <circle cx="168" cy="38" r="6" fill="#ffffff" stroke="#38bdf8" strokeWidth="2" />
          <rect x="92" y="78" width="58" height="7" rx="3.5" fill="#38bdf8" />
          <rect x="176" y="78" width="58" height="7" rx="3.5" fill="#fb7185" />
        </g>
      );

    case 'dodgeball-blitz':
      return (
        <g>
          <line x1="160" y1="10" x2="160" y2="86" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="5 5" />
          {/* Speed-blurred dodgeballs */}
          <line x1="68" y1="32" x2="188" y2="32" stroke="#ff6b2b" strokeWidth="8" strokeLinecap="round" opacity="0.35" />
          <circle cx="192" cy="32" r="11" fill="#ff6b2b" stroke="#ffffff" strokeWidth="2" />
          <line x1="254" y1="64" x2="132" y2="64" stroke="#facc15" strokeWidth="8" strokeLinecap="round" opacity="0.35" />
          <circle cx="128" cy="64" r="11" fill="#facc15" stroke="#ffffff" strokeWidth="2" />
          {/* Players */}
          <circle cx="64" cy="56" r="10" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="256" cy="40" r="10" fill="#2ee59d" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'gravity-flip':
      return (
        <g>
          {/* Ceiling & floor tracks */}
          <rect x="20" y="14" width="280" height="5" rx="2" fill="#38bdf8" />
          <rect x="20" y="77" width="280" height="5" rx="2" fill="#2ee59d" />
          {/* Vertical laser gates */}
          <rect x="112" y="19" width="7" height="32" fill="#fb7185" />
          <rect x="206" y="45" width="7" height="32" fill="#fb7185" />
          {/* Flipping trail */}
          <polyline points="56,70 100,70 132,26 190,26 226,70 264,70" fill="none" stroke="#facc15" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="158" cy="26" r="8" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          {/* Up/down gravity arrows */}
          <path d="M 160 40 L 160 58 M 154 46 L 160 40 L 166 46 M 154 52 L 160 58 L 166 52" stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.7" />
        </g>
      );

    case 'asteroid-dogfight':
      return (
        <g>
          {/* Polygonal space boulders */}
          <polygon points="150,26 172,20 184,38 174,56 152,58 140,42" fill="#1e2433" stroke="#c084fc" strokeWidth="2.5" />
          <polygon points="244,54 264,48 274,64 262,78 242,74" fill="#1e2433" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
          {/* Thruster ships */}
          <polygon points="94,48 68,36 74,48 68,60" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          <polygon points="214,32 238,22 232,34 240,44" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
          {/* Laser bolts */}
          <line x1="98" y1="48" x2="132" y2="44" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
          <line x1="188" y1="36" x2="210" y2="33" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
        </g>
      );

    case 'floor-is-lava':
      return (
        <g>
          {/* Molten lava glow base */}
          <rect x="20" y="54" width="280" height="36" rx="6" fill="#ff6b2b" opacity="0.28" />
          <path d="M 20 76 Q 60 66 100 76 T 180 76 T 260 76 T 300 76" fill="none" stroke="#ff6b2b" strokeWidth="3" />
          {/* Crumbling isometric tiles */}
          <rect x="64" y="24" width="38" height="22" rx="4" fill="#1e2536" stroke="#38bdf8" strokeWidth="2" />
          <rect x="114" y="30" width="38" height="22" rx="4" fill="#2a1c1a" stroke="#ff6b2b" strokeWidth="2" strokeDasharray="4 3" />
          <rect x="164" y="22" width="38" height="22" rx="4" fill="#1e2536" stroke="#2ee59d" strokeWidth="2" />
          <rect x="214" y="34" width="38" height="22" rx="4" fill="#1e2536" stroke="#facc15" strokeWidth="2" />
          {/* Hopping player */}
          <circle cx="183" cy="24" r="8" fill="#2ee59d" stroke="#ffffff" strokeWidth="1.8" />
        </g>
      );

    case 'capture-crown':
      return (
        <g>
          {/* Radiant spotlight beams */}
          <polygon points="160,8 106,88 214,88" fill="#facc15" opacity="0.14" />
          <circle cx="160" cy="48" r="32" fill="none" stroke="#facc15" strokeWidth="2" strokeDasharray="6 5" opacity="0.65" />
          {/* Big golden crown */}
          <polygon
            points="128,62 124,30 144,44 160,22 176,44 196,30 192,62"
            fill="#facc15"
            stroke="#fff7cc"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="144" cy="54" r="3" fill="#ff6b2b" />
          <circle cx="160" cy="54" r="3.5" fill="#38bdf8" />
          <circle cx="176" cy="54" r="3" fill="#2ee59d" />
          {/* Rivals converging */}
          <circle cx="72" cy="54" r="9" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="248" cy="54" r="9" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'laser-tag':
      return (
        <g>
          {/* Stealth maze blocks */}
          <rect x="92" y="14" width="12" height="44" rx="3" fill="#1b2232" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
          <rect x="212" y="38" width="12" height="44" rx="3" fill="#1b2232" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
          {/* 2-bounce green laser beam */}
          <polyline points="54,68 156,16 208,58 266,28" fill="none" stroke="#2ee59d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="156" cy="16" r="5" fill="#ffffff" stroke="#2ee59d" strokeWidth="2" />
          <circle cx="208" cy="58" r="5" fill="#ffffff" stroke="#2ee59d" strokeWidth="2" />
          <circle cx="52" cy="68" r="9" fill="#38bdf8" stroke="#fff" strokeWidth="1.6" />
          <circle cx="268" cy="28" r="9" fill="#fb7185" stroke="#fff" strokeWidth="1.6" />
        </g>
      );

    case 'drift-rally':
      return (
        <g>
          {/* S-curve chicane ribbon */}
          <path d="M 24 76 C 100 76, 108 20, 168 24 C 228 28, 224 74, 296 68" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="24" strokeLinecap="round" />
          <path d="M 24 76 C 100 76, 108 20, 168 24 C 228 28, 224 74, 296 68" fill="none" stroke="#facc15" strokeWidth="2" strokeDasharray="8 6" />
          {/* Drift tire arcs & nitro sparks */}
          <path d="M 118 46 Q 134 26 158 24" fill="none" stroke="#ff6b2b" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="156" y="17" width="22" height="12" rx="4" transform="rotate(14 167 23)" fill="#facc15" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="142" cy="24" r="3" fill="#ff6b2b" />
          <circle cx="136" cy="30" r="2.5" fill="#facc15" />
          <circle cx="144" cy="32" r="2" fill="#ffffff" />
        </g>
      );

    case 'meteor-basketball':
      return (
        <g>
          {/* Backboard & hoop */}
          <rect x="256" y="16" width="8" height="36" rx="2" fill="#e2e8f0" />
          <line x1="226" y1="42" x2="256" y2="42" stroke="#ff6b2b" strokeWidth="4" strokeLinecap="round" />
          {/* Mesh net */}
          <polyline points="230,44 236,64 246,64 252,44" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" />
          <line x1="234" y1="54" x2="248" y2="54" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          {/* Blazing meteor basketball arc */}
          <path d="M 62 70 Q 148 0 238 38" fill="none" stroke="#ff6b2b" strokeWidth="3.5" strokeDasharray="6 4" />
          <circle cx="164" cy="26" r="13" fill="#ff6b2b" stroke="#facc15" strokeWidth="2.5" />
          <path d="M 152 26 L 176 26 M 164 14 L 164 38" stroke="#0b0d12" strokeWidth="1.5" />
        </g>
      );

    case 'rhythm-beatdown':
      return (
        <g>
          {/* Equalizer / rhythm lanes */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const h = [26, 48, 62, 38, 68, 44, 56, 30][i];
            const col = ['#38bdf8', '#c084fc', '#2ee59d', '#facc15'][i % 4];
            return (
              <rect
                key={i}
                x={54 + i * 28}
                y={84 - h}
                width="16"
                height={h}
                rx="4"
                fill={col}
                opacity="0.8"
              />
            );
          })}
          {/* Hit timing ring */}
          <line x1="34" y1="68" x2="286" y2="68" stroke="#ffffff" strokeWidth="2" opacity="0.65" />
          <circle cx="174" cy="68" r="11" fill="none" stroke="#ffffff" strokeWidth="2.5" />
        </g>
      );

    case 'ice-bumper-bash':
      return (
        <g>
          {/* Frozen ice hexagon */}
          <polygon points="104,16 216,16 254,48 216,80 104,80 66,48" fill="#38bdf81c" stroke="#7dd3fc" strokeWidth="2.5" />
          <line x1="104" y1="16" x2="216" y2="80" stroke="#7dd3fc" strokeWidth="1" opacity="0.25" />
          <line x1="216" y1="16" x2="104" y2="80" stroke="#7dd3fc" strokeWidth="1" opacity="0.25" />
          {/* Center bumper */}
          <circle cx="160" cy="48" r="16" fill="#0ea5e9" stroke="#ffffff" strokeWidth="2.5" />
          {/* Gliding players */}
          <circle cx="110" cy="46" r="9" fill="#fb7185" stroke="#ffffff" strokeWidth="1.6" />
          <circle cx="210" cy="52" r="9" fill="#facc15" stroke="#ffffff" strokeWidth="1.6" />
        </g>
      );

    case 'bomber-grid':
      return (
        <g>
          {/* Grid crates */}
          <rect x="52" y="18" width="26" height="26" rx="4" fill="#272c3a" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          <rect x="242" y="18" width="26" height="26" rx="4" fill="#272c3a" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          <rect x="52" y="54" width="26" height="26" rx="4" fill="#272c3a" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          <rect x="242" y="54" width="26" height="26" rx="4" fill="#272c3a" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          {/* Cross explosion blast */}
          <rect x="86" y="38" width="148" height="20" rx="10" fill="#ff6b2b" opacity="0.88" />
          <rect x="150" y="10" width="20" height="76" rx="10" fill="#ff6b2b" opacity="0.88" />
          <rect x="102" y="43" width="116" height="10" rx="5" fill="#facc15" />
          <rect x="155" y="18" width="10" height="60" rx="5" fill="#facc15" />
          <circle cx="160" cy="48" r="9" fill="#ffffff" />
        </g>
      );

    case 'tug-of-war':
      return (
        <g>
          {/* Center abyss pit */}
          <rect x="142" y="14" width="36" height="68" rx="8" fill="#05070c" stroke="#fb7185" strokeWidth="2" strokeDasharray="4 4" />
          {/* Taut plasma rope */}
          <line x1="48" y1="48" x2="272" y2="48" stroke="#facc15" strokeWidth="6" strokeLinecap="round" />
          <line x1="48" y1="48" x2="272" y2="48" stroke="#ffffff" strokeWidth="2" strokeDasharray="8 6" />
          {/* Core knot */}
          <circle cx="154" cy="48" r="11" fill="#ff6b2b" stroke="#ffffff" strokeWidth="2.5" />
          {/* 2v2 teams */}
          <circle cx="64" cy="48" r="10" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="96" cy="48" r="10" fill="#4ade80" stroke="#fff" strokeWidth="1.5" />
          <circle cx="224" cy="48" r="10" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
          <circle cx="256" cy="48" r="10" fill="#facc15" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'bullet-hell-boss':
      return (
        <g>
          {/* Spiral bullet curtains */}
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 16;
            const r1 = 28 + (i % 2) * 14;
            const r2 = 44 + ((i + 1) % 2) * 12;
            return (
              <g key={i}>
                <circle cx={160 + Math.cos(a) * r1} cy={48 + Math.sin(a) * (r1 * 0.65)} r="3.5" fill="#fb7185" />
                <circle cx={160 + Math.cos(a + 0.25) * r2} cy={48 + Math.sin(a + 0.25) * (r2 * 0.65)} r="3" fill="#facc15" />
              </g>
            );
          })}
          {/* Cyber-Core boss */}
          <polygon points="160,24 182,48 160,72 138,48" fill="#181d2a" stroke="#fb7185" strokeWidth="3" />
          <circle cx="160" cy="48" r="9" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
        </g>
      );

    case 'soccer-striker':
      return (
        <g>
          {/* Pitch */}
          <rect x="36" y="14" width="248" height="68" rx="8" fill="#2ee59d14" stroke="#2ee59d" strokeWidth="2" />
          <line x1="160" y1="14" x2="160" y2="82" stroke="#2ee59d" strokeWidth="1.5" opacity="0.6" />
          <circle cx="160" cy="48" r="18" fill="none" stroke="#2ee59d" strokeWidth="1.5" opacity="0.6" />
          {/* Goals */}
          <rect x="26" y="32" width="10" height="32" fill="none" stroke="#ffffff" strokeWidth="2" />
          <rect x="284" y="32" width="10" height="32" fill="none" stroke="#ffffff" strokeWidth="2" />
          {/* Curved strike & ball */}
          <path d="M 104 60 Q 170 22 252 44" fill="none" stroke="#facc15" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="212" cy="36" r="9" fill="#ffffff" stroke="#0b0d12" strokeWidth="2" />
          <polygon points="212,31 216,35 214,40 210,40 208,35" fill="#0b0d12" />
        </g>
      );

    case 'king-of-hill':
      return (
        <g>
          {/* Capture zone beam */}
          <rect x="118" y="8" width="84" height="72" fill="#c084fc" opacity="0.12" />
          <polygon points="122,30 198,30 216,56 198,80 122,80 104,56" fill="#c084fc24" stroke="#c084fc" strokeWidth="2.5" />
          <circle cx="160" cy="54" r="24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65" />
          {/* King & crown */}
          <circle cx="160" cy="56" r="12" fill="#c084fc" stroke="#ffffff" strokeWidth="2" />
          <polygon points="148,38 150,24 156,31 160,20 164,31 170,24 172,38" fill="#facc15" />
        </g>
      );

    case 'laser-roulette':
      return (
        <g>
          <circle cx="160" cy="48" r="36" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
          {/* Double-cross sweeping laser beams */}
          <line x1="44" y1="14" x2="276" y2="82" stroke="#ef4444" strokeWidth="5" opacity="0.85" />
          <line x1="44" y1="14" x2="276" y2="82" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="68" y1="84" x2="252" y2="12" stroke="#fb7185" strokeWidth="5" opacity="0.85" />
          <line x1="68" y1="84" x2="252" y2="12" stroke="#ffffff" strokeWidth="1.5" />
          {/* Emitter core */}
          <circle cx="160" cy="48" r="11" fill="#181c28" stroke="#ef4444" strokeWidth="3" />
          <circle cx="160" cy="48" r="4" fill="#ffffff" />
          {/* Orbiting dodger */}
          <circle cx="160" cy="18" r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
        </g>
      );

    case 'pinball-wizard':
      return (
        <g>
          {/* Gold bumpers */}
          <circle cx="118" cy="34" r="15" fill="#facc1533" stroke="#facc15" strokeWidth="3" />
          <circle cx="118" cy="34" r="6" fill="#facc15" />
          <circle cx="202" cy="34" r="15" fill="#facc1533" stroke="#facc15" strokeWidth="3" />
          <circle cx="202" cy="34" r="6" fill="#facc15" />
          <circle cx="160" cy="58" r="13" fill="#ff6b2b33" stroke="#ff6b2b" strokeWidth="2.5" />
          {/* Flippers */}
          <line x1="78" y1="74" x2="126" y2="84" stroke="#38bdf8" strokeWidth="7" strokeLinecap="round" />
          <line x1="242" y1="74" x2="194" y2="84" stroke="#fb7185" strokeWidth="7" strokeLinecap="round" />
          {/* Silver multi-balls */}
          <circle cx="152" cy="24" r="6" fill="#f8fafc" stroke="#38bdf8" strokeWidth="2" />
          <circle cx="182" cy="64" r="6" fill="#f8fafc" stroke="#facc15" strokeWidth="2" />
        </g>
      );

    case 'cannon-barrage':
      return (
        <g>
          {/* Corner artillery turrets */}
          <circle cx="42" cy="76" r="12" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <line x1="48" y1="70" x2="66" y2="56" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
          <circle cx="278" cy="76" r="12" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
          <line x1="272" y1="70" x2="254" y2="56" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
          {/* Mortar arcs */}
          <path d="M 68 54 Q 124 4 160 44" fill="none" stroke="#ff6b2b" strokeWidth="3" strokeDasharray="5 4" />
          <path d="M 252 54 Q 196 4 160 44" fill="none" stroke="#facc15" strokeWidth="3" strokeDasharray="5 4" />
          {/* Center blast */}
          <polygon points="160,22 167,37 183,35 171,47 179,62 162,54 148,64 152,48 138,38 154,37" fill="#ff6b2b" stroke="#facc15" strokeWidth="1.5" />
        </g>
      );

    case 'neon-volleys':
      return (
        <g>
          {/* Floor & Net */}
          <line x1="28" y1="80" x2="292" y2="80" stroke="#2ee59d" strokeWidth="3" />
          <line x1="160" y1="40" x2="160" y2="80" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          {/* High-arc volley */}
          <path d="M 88 58 Q 160 -2 230 56" fill="none" stroke="#2ee59d" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="182" cy="24" r="11" fill="#facc15" stroke="#ffffff" strokeWidth="2" />
          {/* Spikers */}
          <circle cx="88" cy="64" r="10" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="232" cy="54" r="10" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
        </g>
      );

    case 'pac-chase':
      return (
        <g>
          {/* Chomper */}
          <path d="M 104 48 L 128 32 A 24 24 0 1 0 128 64 Z" fill="#facc15" stroke="#fff7cc" strokeWidth="1.8" />
          {/* Pellets & Orange Power Core */}
          <circle cx="144" cy="48" r="4" fill="#ffffff" />
          <circle cx="164" cy="48" r="4" fill="#ffffff" />
          <circle cx="188" cy="48" r="9" fill="#ff6b2b" stroke="#facc15" strokeWidth="2" />
          {/* Frightened cyber ghost */}
          <path d="M 222 62 L 222 42 A 14 14 0 0 1 250 42 L 250 62 L 243 56 L 236 62 L 229 56 Z" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="231" cy="44" r="2.5" fill="#0b0d12" />
          <circle cx="241" cy="44" r="2.5" fill="#0b0d12" />
        </g>
      );

    case 'asteroid-miners':
      return (
        <g>
          {/* Crystal asteroid */}
          <polygon points="184,22 224,18 242,46 226,76 188,74 174,48" fill="#1b2333" stroke="#2ee59d" strokeWidth="2.5" />
          {/* Spilling gold gems */}
          <polygon points="204,40 212,48 204,56 196,48" fill="#facc15" />
          <polygon points="164,62 170,68 164,74 158,68" fill="#facc15" />
          <polygon points="154,28 160,34 154,40 148,34" fill="#2ee59d" />
          {/* Mining rig & laser */}
          <polygon points="94,48 64,34 72,48 64,62" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="94" y1="48" x2="188" y2="48" stroke="#2ee59d" strokeWidth="4.5" strokeLinecap="round" />
          <line x1="94" y1="48" x2="188" y2="48" stroke="#ffffff" strokeWidth="1.5" />
        </g>
      );

    case 'demolition-derby':
      return (
        <g>
          {/* Colliding armored cars */}
          <rect x="66" y="36" width="54" height="24" rx="6" transform="rotate(-8 93 48)" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          <rect x="200" y="36" width="54" height="24" rx="6" transform="rotate(8 227 48)" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
          {/* Jagged collision starburst */}
          <polygon points="160,16 168,36 188,30 174,48 188,66 168,60 160,80 152,60 132,66 146,48 132,30 152,36" fill="#ff6b2b" stroke="#facc15" strokeWidth="2" />
          <circle cx="160" cy="48" r="6" fill="#ffffff" />
        </g>
      );

    case 'grapple-swing':
      return (
        <g>
          {/* Ceiling anchors */}
          <circle cx="96" cy="14" r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          <circle cx="218" cy="14" r="6" fill="#2ee59d" stroke="#ffffff" strokeWidth="2" />
          {/* Grapple tether & swing arc */}
          <line x1="96" y1="14" x2="148" y2="62" stroke="#38bdf8" strokeWidth="3" />
          <path d="M 52 56 Q 104 88 156 58 Q 204 34 252 62" fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="5 4" opacity="0.7" />
          <circle cx="148" cy="62" r="10" fill="#ff6b2b" stroke="#ffffff" strokeWidth="2" />
        </g>
      );

    case 'flappy-squad':
      return (
        <g>
          {/* Laser pipes */}
          <rect x="116" y="0" width="22" height="32" rx="3" fill="#4ade80" opacity="0.8" />
          <rect x="116" y="64" width="22" height="32" rx="3" fill="#4ade80" opacity="0.8" />
          <rect x="218" y="0" width="22" height="46" rx="3" fill="#4ade80" opacity="0.8" />
          <rect x="218" y="76" width="22" height="20" rx="3" fill="#4ade80" opacity="0.8" />
          {/* Winged cyber-birds */}
          <g transform="translate(80,48)">
            <circle cx="0" cy="0" r="8" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
            <polygon points="-8,-2 -16,-8 -12,4" fill="#ffffff" />
            <polygon points="8,-2 14,0 8,3" fill="#facc15" />
          </g>
          <g transform="translate(172,54)">
            <circle cx="0" cy="0" r="8" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
            <polygon points="-8,-2 -16,-8 -12,4" fill="#ffffff" />
            <polygon points="8,-2 14,0 8,3" fill="#facc15" />
          </g>
        </g>
      );

    case 'snowball-fight':
      return (
        <g>
          {/* Mega snowball */}
          <circle cx="160" cy="48" r="22" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="3" />
          <circle cx="152" cy="40" r="5" fill="#ffffff" />
          {/* Flying snowballs */}
          <line x1="56" y1="30" x2="112" y2="40" stroke="#7dd3fc" strokeWidth="3" strokeDasharray="4 4" />
          <circle cx="114" cy="40" r="8" fill="#ffffff" stroke="#7dd3fc" strokeWidth="2" />
          <line x1="264" y1="68" x2="210" y2="58" stroke="#7dd3fc" strokeWidth="3" strokeDasharray="4 4" />
          <circle cx="208" cy="58" r="8" fill="#ffffff" stroke="#7dd3fc" strokeWidth="2" />
          {/* Snowflakes */}
          <path d="M 74 66 L 74 78 M 68 72 L 80 72 M 244 20 L 244 32 M 238 26 L 250 26" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    case 'ghost-hunt':
      return (
        <g>
          {/* Flashlight cone beam */}
          <polygon points="62,64 252,14 252,82" fill="#facc15" opacity="0.2" />
          <circle cx="58" cy="64" r="10" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          {/* Revealed translucent phantom */}
          <path d="M 186 68 L 186 40 A 18 18 0 0 1 222 40 L 222 68 L 213 61 L 204 68 L 195 61 Z" fill="#c084fc" opacity="0.88" stroke="#ffffff" strokeWidth="2" />
          <circle cx="198" cy="44" r="3" fill="#ffffff" />
          <circle cx="210" cy="44" r="3" fill="#ffffff" />
          {/* Proton zap */}
          <polyline points="68,62 114,50 130,58 184,48" fill="none" stroke="#c084fc" strokeWidth="3" />
        </g>
      );

    case 'conveyor-chaos':
      return (
        <g>
          {/* Opposing conveyor belts */}
          <rect x="44" y="20" width="232" height="22" rx="4" fill="#1a2030" stroke="#ff6b2b" strokeWidth="2" />
          <rect x="44" y="54" width="232" height="22" rx="4" fill="#1a2030" stroke="#38bdf8" strokeWidth="2" />
          {/* Belt chevrons */}
          {[80, 120, 160, 200, 240].map((x) => (
            <g key={x}>
              <polyline points={`${x - 6},25 ${x + 4},31 ${x - 6},37`} fill="none" stroke="#ff6b2b" strokeWidth="2" opacity="0.7" />
              <polyline points={`${x + 6},59 ${x - 4},65 ${x + 6},71`} fill="none" stroke="#38bdf8" strokeWidth="2" opacity="0.7" />
            </g>
          ))}
          {/* Saw blades on sides */}
          <circle cx="30" cy="48" r="16" fill="#fb7185" stroke="#ffffff" strokeWidth="2" strokeDasharray="5 3" />
          <circle cx="290" cy="48" r="16" fill="#fb7185" stroke="#ffffff" strokeWidth="2" strokeDasharray="5 3" />
        </g>
      );

    case 'cyber-golf':
      return (
        <g>
          {/* Neon putting green */}
          <ellipse cx="164" cy="54" rx="116" ry="30" fill="#2ee59d18" stroke="#2ee59d" strokeWidth="2" />
          {/* Hole & Flag */}
          <ellipse cx="234" cy="50" rx="10" ry="6" fill="#05070c" stroke="#2ee59d" strokeWidth="2" />
          <line x1="234" y1="50" x2="234" y2="14" stroke="#ffffff" strokeWidth="2.5" />
          <polygon points="234,14 260,22 234,30" fill="#ff6b2b" />
          {/* Aim dotted arc + golf ball */}
          <path d="M 92 60 Q 160 38 228 50" fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="4 4" />
          <circle cx="92" cy="60" r="8" fill="#ffffff" stroke="#2ee59d" strokeWidth="2" />
        </g>
      );

    case 'tower-siege':
      return (
        <g>
          {/* Central tower core */}
          <circle cx="160" cy="48" r="24" fill="#38bdf81c" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 4" />
          <polygon points="160,30 176,48 160,66 144,48" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          {/* Swarming drones */}
          <polygon points="62,28 76,34 62,40" fill="#fb7185" />
          <polygon points="74,64 88,68 74,74" fill="#fb7185" />
          <polygon points="258,30 244,36 258,42" fill="#ff6b2b" />
          <polygon points="248,66 234,70 248,76" fill="#ff6b2b" />
          {/* Defense blaster fire */}
          <line x1="142" y1="42" x2="82" y2="34" stroke="#2ee59d" strokeWidth="2.5" />
          <line x1="178" y1="44" x2="238" y2="36" stroke="#facc15" strokeWidth="2.5" />
        </g>
      );

    case 'hyper-memory-grid':
      return (
        <g>
          {/* 3x3 Neon Memory Grid */}
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => {
              const lit = (r === 0 && c === 1) || (r === 1 && c === 2) || (r === 2 && c === 0);
              return (
                <rect
                  key={`${r}-${c}`}
                  x={104 + c * 40}
                  y={10 + r * 26}
                  width="32"
                  height="20"
                  rx="4"
                  fill={lit ? '#facc15' : '#181e2c'}
                  stroke={lit ? '#ffffff' : 'rgba(255,255,255,0.2)'}
                  strokeWidth="1.8"
                />
              );
            }),
          )}
          <polyline points="160,20 200,46 120,72" fill="none" stroke="#2ee59d" strokeWidth="2.5" strokeDasharray="4 3" />
        </g>
      );

    case 'meteor-tennis':
      return (
        <g>
          <rect x="44" y="14" width="232" height="68" rx="6" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
          <line x1="160" y1="14" x2="160" y2="82" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="4 3" />
          {/* Racket swing arcs */}
          <path d="M 76 26 A 26 26 0 0 1 76 70" fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
          <path d="M 244 26 A 26 26 0 0 0 244 70" fill="none" stroke="#2ee59d" strokeWidth="4" strokeLinecap="round" />
          {/* Fireball smash */}
          <line x1="88" y1="54" x2="212" y2="34" stroke="#ff6b2b" strokeWidth="8" strokeLinecap="round" opacity="0.4" />
          <circle cx="212" cy="34" r="9" fill="#facc15" stroke="#ff6b2b" strokeWidth="3" />
        </g>
      );

    case 'vortex-survival':
      return (
        <g>
          {/* Swirling black hole accretion vortex */}
          <ellipse cx="160" cy="48" rx="74" ry="34" fill="none" stroke="#c084fc" strokeWidth="2" opacity="0.35" />
          <ellipse cx="160" cy="48" rx="52" ry="24" fill="none" stroke="#c084fc" strokeWidth="2.5" strokeDasharray="14 8" opacity="0.7" />
          <ellipse cx="160" cy="48" rx="30" ry="15" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="10 6" />
          <circle cx="160" cy="48" r="14" fill="#040509" stroke="#c084fc" strokeWidth="3" />
          {/* Thrusting ships escaping */}
          <circle cx="96" cy="36" r="7" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="226" cy="58" r="7" fill="#facc15" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'jetpack-joust':
      return (
        <g>
          {/* Floating ledges */}
          <rect x="44" y="68" width="76" height="6" rx="3" fill="rgba(255,255,255,0.28)" />
          <rect x="200" y="68" width="76" height="6" rx="3" fill="rgba(255,255,255,0.28)" />
          {/* Jousting fighter left with jetpack flame & lance */}
          <polygon points="94,54 88,68 100,68" fill="#ff6b2b" />
          <circle cx="94" cy="44" r="11" fill="#facc15" stroke="#ffffff" strokeWidth="1.8" />
          <line x1="104" y1="44" x2="152" y2="44" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          {/* Rival right */}
          <polygon points="222,42 216,56 228,56" fill="#ff6b2b" />
          <circle cx="222" cy="32" r="11" fill="#fb7185" stroke="#ffffff" strokeWidth="1.8" />
          <line x1="212" y1="32" x2="164" y2="32" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
        </g>
      );

    case 'crate-dropper':
      return (
        <g>
          {/* Rising floor laser */}
          <rect x="20" y="78" width="280" height="6" rx="3" fill="#ff6b2b" />
          <rect x="20" y="80" width="280" height="2" fill="#ffffff" />
          {/* Stacked & falling crates */}
          <rect x="92" y="50" width="28" height="26" rx="4" fill="#ff6b2b" stroke="#facc15" strokeWidth="2" />
          <line x1="96" y1="54" x2="116" y2="72" stroke="#0b0d12" strokeWidth="2" />
          <rect x="144" y="48" width="28" height="28" rx="4" fill="#facc15" stroke="#ffffff" strokeWidth="2" />
          <rect x="144" y="12" width="28" height="24" rx="4" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.8" strokeDasharray="4 3" />
          <rect x="198" y="50" width="28" height="26" rx="4" fill="#2ee59d" stroke="#ffffff" strokeWidth="1.8" />
          <circle cx="158" cy="40" r="7" fill="#fb7185" stroke="#ffffff" strokeWidth="1.5" />
        </g>
      );

    case 'simon-duel':
      return (
        <g>
          {/* 4-quadrant glowing Simon ring */}
          <path d="M 156 14 A 34 34 0 0 0 126 44 L 144 44 A 16 16 0 0 1 156 32 Z" fill="#38bdf8" />
          <path d="M 164 14 A 34 34 0 0 1 194 44 L 176 44 A 16 16 0 0 0 164 32 Z" fill="#fb7185" />
          <path d="M 126 52 A 34 34 0 0 0 156 82 L 156 64 A 16 16 0 0 1 144 52 Z" fill="#4ade80" />
          <path d="M 194 52 A 34 34 0 0 1 164 82 L 164 64 A 16 16 0 0 0 176 52 Z" fill="#facc15" />
          <circle cx="160" cy="48" r="10" fill="#0b0d12" stroke="#ffffff" strokeWidth="2" />
          {/* Pulse rings */}
          <circle cx="160" cy="48" r="42" fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.55" />
        </g>
      );

    case 'orbital-shield':
      return (
        <g>
          {/* Player core */}
          <circle cx="160" cy="48" r="13" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          {/* Glowing orbital shield arc */}
          <path d="M 184 22 A 34 34 0 0 1 184 74" fill="none" stroke="#2ee59d" strokeWidth="6" strokeLinecap="round" />
          <path d="M 184 22 A 34 34 0 0 1 184 74" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
          {/* Homing laser parried */}
          <polyline points="274,26 196,48 264,74" fill="none" stroke="#fb7185" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="196" cy="48" r="6" fill="#ffffff" />
        </g>
      );

    case 'cyber-relay':
      return (
        <g>
          {/* Twin neon speedway lanes */}
          <line x1="20" y1="30" x2="300" y2="30" stroke="#2ee59d" strokeWidth="2" opacity="0.5" />
          <line x1="20" y1="66" x2="300" y2="66" stroke="#38bdf8" strokeWidth="2" opacity="0.5" />
          {/* Heat boost zone */}
          <rect x="130" y="34" width="60" height="28" rx="6" fill="#2ee59d26" stroke="#2ee59d" strokeWidth="2" strokeDasharray="5 3" />
          {/* Speedster + streaks */}
          <line x1="56" y1="48" x2="146" y2="48" stroke="#2ee59d" strokeWidth="6" strokeLinecap="round" opacity="0.45" />
          <polygon points="184,48 150,36 158,48 150,60" fill="#2ee59d" stroke="#ffffff" strokeWidth="1.8" />
          <circle cx="222" cy="48" r="10" fill="none" stroke="#facc15" strokeWidth="2.5" />
        </g>
      );

    case 'treasure-divers':
      return (
        <g>
          {/* Underwater light rays */}
          <polygon points="90,0 130,0 164,96 112,96" fill="#38bdf8" opacity="0.1" />
          <polygon points="180,0 220,0 250,96 200,96" fill="#38bdf8" opacity="0.08" />
          {/* Rising bubbles */}
          <circle cx="88" cy="36" r="5" fill="none" stroke="#7dd3fc" strokeWidth="1.8" />
          <circle cx="98" cy="20" r="3.5" fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
          <circle cx="222" cy="28" r="5" fill="none" stroke="#7dd3fc" strokeWidth="1.8" />
          {/* Sunken golden chest */}
          <rect x="134" y="54" width="52" height="28" rx="5" fill="#d97706" stroke="#facc15" strokeWidth="2.5" />
          <line x1="134" y1="66" x2="186" y2="66" stroke="#facc15" strokeWidth="2.5" />
          <circle cx="160" cy="66" r="4" fill="#ffffff" />
          {/* Shark fin silhouette */}
          <path d="M 228 46 Q 242 22 254 46 Z" fill="#fb7185" opacity="0.8" />
        </g>
      );

    case 'mirror-blades':
      return (
        <g>
          {/* Crossed neon katana blades */}
          <line x1="78" y1="76" x2="238" y2="18" stroke="#fb7185" strokeWidth="6" strokeLinecap="round" />
          <line x1="78" y1="76" x2="238" y2="18" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
          <line x1="82" y1="18" x2="242" y2="76" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" />
          <line x1="82" y1="18" x2="242" y2="76" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
          {/* Center clash glint */}
          <polygon points="160,26 165,43 182,47 165,51 160,68 155,51 138,47 155,43" fill="#ffffff" />
          <circle cx="160" cy="47" r="22" fill="none" stroke="#facc15" strokeWidth="1.5" strokeDasharray="4 4" />
        </g>
      );

    case 'asteroid-bowling':
      return (
        <g>
          {/* Perspective cosmic alley */}
          <polygon points="94,88 134,14 186,14 226,88" fill="#facc1514" stroke="#facc15" strokeWidth="1.8" opacity="0.65" />
          {/* Bowling pins formation */}
          {[
            [160, 22],
            [150, 30],
            [170, 30],
            [140, 38],
            [160, 38],
            [180, 38],
          ].map(([px, py], i) => (
            <circle key={i} cx={px} cy={py} r="4.5" fill="#ffffff" stroke="#fb7185" strokeWidth="1.5" />
          ))}
          {/* Curving asteroid bowling ball */}
          <path d="M 148 80 Q 178 62 162 42" fill="none" stroke="#ff6b2b" strokeWidth="3" strokeDasharray="4 3" />
          <circle cx="162" cy="64" r="12" fill="#facc15" stroke="#ff6b2b" strokeWidth="2.5" />
          <circle cx="159" cy="60" r="2" fill="#0b0d12" />
          <circle cx="165" cy="60" r="2" fill="#0b0d12" />
          <circle cx="162" cy="65" r="2" fill="#0b0d12" />
        </g>
      );

    case 'laser-limbo':
      return (
        <g>
          {/* Horizontal high/low laser sweepers */}
          <line x1="24" y1="28" x2="296" y2="28" stroke="#fb7185" strokeWidth="5" />
          <line x1="24" y1="28" x2="296" y2="28" stroke="#ffffff" strokeWidth="1.5" />
          <line x1="24" y1="70" x2="296" y2="70" stroke="#ff6b2b" strokeWidth="5" />
          <line x1="24" y1="70" x2="296" y2="70" stroke="#ffffff" strokeWidth="1.5" />
          {/* Acrobat ducking & jumping */}
          <ellipse cx="122" cy="54" rx="14" ry="8" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          <circle cx="204" cy="48" r="10" fill="#2ee59d" stroke="#ffffff" strokeWidth="2" />
        </g>
      );

    case 'magnet-pull':
      return (
        <g>
          {/* Polarity field rings */}
          <circle cx="160" cy="48" r="38" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeDasharray="6 4" opacity="0.55" />
          <circle cx="160" cy="48" r="26" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="5 4" opacity="0.75" />
          {/* U-Magnet */}
          <path d="M 142 28 L 142 52 A 18 18 0 0 0 178 52 L 178 28" fill="none" stroke="#c084fc" strokeWidth="9" strokeLinecap="butt" />
          <rect x="137.5" y="22" width="9" height="8" fill="#38bdf8" />
          <rect x="173.5" y="22" width="9" height="8" fill="#fb7185" />
          {/* Coins & bomb */}
          <circle cx="96" cy="46" r="7" fill="#facc15" stroke="#fff" strokeWidth="1.5" />
          <circle cx="226" cy="46" r="8" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
        </g>
      );

    case 'neon-snake-pong':
      return (
        <g>
          {/* Living snake paddles */}
          <path d="M 52 22 C 66 36, 44 58, 60 76" fill="none" stroke="#4ade80" strokeWidth="10" strokeLinecap="round" />
          <circle cx="60" cy="76" r="6" fill="#ffffff" stroke="#4ade80" strokeWidth="2" />
          <path d="M 268 74 C 254 56, 276 36, 260 20" fill="none" stroke="#38bdf8" strokeWidth="10" strokeLinecap="round" />
          <circle cx="260" cy="20" r="6" fill="#ffffff" stroke="#38bdf8" strokeWidth="2" />
          {/* Twin bouncing balls */}
          <line x1="70" y1="48" x2="152" y2="30" stroke="#facc15" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="152" cy="30" r="7" fill="#facc15" stroke="#ffffff" strokeWidth="2" />
          <line x1="250" y1="54" x2="174" y2="66" stroke="#fb7185" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="174" cy="66" r="7" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
        </g>
      );

    case 'meteor-strike-coop':
      return (
        <g>
          {/* 4 city shield domes */}
          {[68, 128, 192, 252].map((cx) => (
            <path key={cx} d={`M ${cx - 18} 82 A 18 18 0 0 1 ${cx + 18} 82 Z`} fill="#38bdf833" stroke="#38bdf8" strokeWidth="2" />
          ))}
          {/* Descending boss meteor */}
          <line x1="160" y1="4" x2="160" y2="34" stroke="#ff6b2b" strokeWidth="12" strokeLinecap="round" opacity="0.35" />
          <circle cx="160" cy="34" r="14" fill="#ff6b2b" stroke="#facc15" strokeWidth="2.5" />
          {/* Upward co-op defense beams */}
          <line x1="128" y1="68" x2="154" y2="44" stroke="#2ee59d" strokeWidth="2.5" />
          <line x1="192" y1="68" x2="166" y2="44" stroke="#facc15" strokeWidth="2.5" />
        </g>
      );

    case 'grand-gauntlet':
    default:
      return (
        <g>
          {/* Radiant championship rays */}
          <circle cx="160" cy="48" r="38" fill="#facc1518" stroke="#facc15" strokeWidth="1.8" strokeDasharray="6 4" />
          {/* Trophy cup */}
          <path d="M 138 22 L 182 22 L 176 48 A 16 16 0 0 1 144 48 Z" fill="#facc15" stroke="#fff7cc" strokeWidth="2" />
          <path d="M 138 28 Q 124 30 128 44 Q 132 50 143 48" fill="none" stroke="#facc15" strokeWidth="3" />
          <path d="M 182 28 Q 196 30 192 44 Q 188 50 177 48" fill="none" stroke="#facc15" strokeWidth="3" />
          <rect x="155" y="60" width="10" height="12" fill="#facc15" />
          <rect x="142" y="72" width="36" height="7" rx="3" fill="#fff7cc" />
          {/* Four stage emblem pips */}
          <circle cx="94" cy="48" r="5" fill="#38bdf8" />
          <circle cx="110" cy="28" r="4" fill="#fb7185" />
          <circle cx="226" cy="48" r="5" fill="#2ee59d" />
          <circle cx="210" cy="28" r="4" fill="#c084fc" />
        </g>
      );
  }
}

const CartridgeArtworkImpl: React.FC<CartridgeArtworkProps> = ({
  game,
  compact = false,
  variant,
  className = '',
  bare = false,
}) => {
  const effectiveVariant: 'tile' | 'hero' | 'compact' =
    variant ?? (compact ? 'compact' : 'tile');
  const isHero = effectiveVariant === 'hero';
  const isCompact = effectiveVariant === 'compact';
  const uid = `${game.id.replace(/[^a-z0-9]/gi, '')}-${effectiveVariant}`;

  if (isCompact) {
    return (
      <div
        className={`relative w-full h-20 overflow-hidden rounded-xl border border-white/15 bg-[#090810] shadow-[inset_0_2px_12px_rgba(0,0,0,0.85)] ${className}`}
      >
        <svg
          viewBox="0 0 320 96"
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full block"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={`spot-${uid}`} cx="50%" cy="48%" r="62%">
              <stop offset="0%" stopColor={game.accent} stopOpacity="0.42" />
              <stop offset="65%" stopColor={game.accent} stopOpacity="0.1" />
              <stop offset="100%" stopColor="#090810" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`g-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={game.accent} stopOpacity="0" />
              <stop offset="100%" stopColor={game.accent} stopOpacity="1" />
            </linearGradient>
            <pattern
              id={`grid-${uid}`}
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(24)"
            >
              <path
                d="M 18 0 L 0 0 0 18"
                fill="none"
                stroke="rgba(255,255,255,0.045)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="320" height="96" fill="#090810" />
          <rect width="320" height="96" fill={`url(#grid-${uid})`} />
          <rect width="320" height="96" fill={`url(#spot-${uid})`} />
          {renderArtworkScene(game.id, game.accent, uid)}
          <rect x="0" y="0" width="320" height="3" fill={game.accent} />
        </svg>
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" />
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#090811] ${className}`}
    >
      <svg
        viewBox="0 0 320 200"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full block"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`bg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#121020" />
            <stop offset="55%" stopColor="#0B0A14" />
            <stop offset="100%" stopColor="#06050A" />
          </linearGradient>
          <radialGradient
            id={`spot-${uid}`}
            cx={isHero ? '52%' : '50%'}
            cy={isHero ? '46%' : '38%'}
            r={isHero ? '68%' : '64%'}
          >
            <stop
              offset="0%"
              stopColor={game.accent}
              stopOpacity={isHero ? '0.46' : '0.38'}
            />
            <stop
              offset="48%"
              stopColor={game.accent}
              stopOpacity={isHero ? '0.16' : '0.12'}
            />
            <stop offset="100%" stopColor="#07060B" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`corner-${uid}`} cx="14%" cy="14%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`g-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={game.accent} stopOpacity="0" />
            <stop offset="100%" stopColor={game.accent} stopOpacity="1" />
          </linearGradient>
          <pattern
            id={`grid-${uid}`}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(24)"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="rgba(255,255,255,0.045)"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* Deep obsidian cinema base + micro grid */}
        <rect width="320" height="200" fill={`url(#bg-${uid})`} />
        <rect width="320" height="200" fill={`url(#grid-${uid})`} />

        {/* Radiant accent spotlight + specular corner glow */}
        <rect width="320" height="200" fill={`url(#spot-${uid})`} />
        <rect width="320" height="200" fill={`url(#corner-${uid})`} />

        {/* Subtle kinetic cinema halo rings for hero showcase */}
        {isHero && (
          <g opacity="0.22">
            <circle
              cx="160"
              cy="96"
              r="76"
              fill="none"
              stroke={game.accent}
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            <circle
              cx="160"
              cy="96"
              r="114"
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="0.8"
            />
          </g>
        )}

        {/* Ghosted giant cartridge serial watermark */}
        {!bare && (
        <text
          x="306"
          y={isHero ? '176' : '116'}
          textAnchor="end"
          fontFamily="Syne, Bricolage Grotesque, sans-serif"
          fontWeight="800"
          fontSize={isHero ? '82' : '58'}
          fill="rgba(255,255,255,0.05)"
          letterSpacing="-3"
        >
          {game.number}
        </text>
        )}

        {/* Uncropped, aspect-true bespoke game scene */}
        <g
          transform={
            isHero
              ? 'translate(-10, 42) scale(1.06)'
              : 'translate(-3, 22) scale(1.02)'
          }
        >
          {renderArtworkScene(game.id, game.accent, uid)}
        </g>

        {!bare && (
          <>
            {/* Top glowing cinema accent hairline */}
            <rect x="0" y="0" width="320" height={isHero ? '4' : '3'} fill={game.accent} />

            {/* Subtle top glass reflection arc */}
            <path
              d="M 0 0 L 320 0 L 320 42 Q 160 76 0 46 Z"
              fill="rgba(255, 255, 255, 0.065)"
            />
          </>
        )}

        {/* Hero precision viewfinder corner ticks */}
        {isHero && !bare && (
          <g stroke="rgba(255,255,255,0.26)" strokeWidth="1.2" fill="none">
            <path d="M 12 22 L 12 12 L 22 12" />
            <path d="M 298 12 L 308 12 L 308 22" />
            <path d="M 12 178 L 12 188 L 22 188" />
            <path d="M 298 188 L 308 188 L 308 178" />
          </g>
        )}
      </svg>

      {!bare && (
        <>
      {/* Specular glass rim + subtle depth vignette */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-28px_40px_rgba(7,6,11,0.52)]" />

      {/* Dynamic holographic diagonal foil sweep on hover */}
      <div
        className="cart-sheen-bar pointer-events-none absolute inset-y-0 -left-1/2 w-2/3 opacity-85"
        style={{
          background:
            'linear-gradient(105deg, transparent 15%, rgba(255,255,255,0.08) 34%, rgba(255,255,255,0.3) 48%, rgba(181,255,42,0.14) 54%, rgba(34,211,238,0.16) 60%, transparent 78%)',
        }}
      />
        </>
      )}
    </div>
  );
};

/** Pure SVG: skip re-rendering 60 covers whenever the vault's focus moves. */
export const CartridgeArtwork = React.memo(CartridgeArtworkImpl);
