import React, { useCallback, useEffect, useRef } from 'react';
import {
  CONTROLLER_LAYOUT_META,
  ControllerLayoutId,
  GAMEPAD_BUTTON,
} from '@couch-emu/shared';
import {
  AnalogStick,
  DirectionalAxisButton,
  TactileButton,
  TouchDPad,
} from './TouchPrimitives';

export interface ControllerDeckProps {
  layout: ControllerLayoutId;
  playerColor: string;
  playerSlot?: number;
  hapticsEnabled: boolean;
  soundClicks?: boolean;
  isPortrait?: boolean;
  gameTitle?: string;
  gameControls?: string;
  gameAccent?: string;
  rumbleActive?: boolean;
  onButtonChange: (buttonIndex: number, pressed: boolean) => void;
  onDirectionsChange: (dirs: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  }) => void;
  onStickChange: (stick: 'left' | 'right', x: number, y: number) => void;
}

type ShellTone = 'dark' | 'graphite' | 'indigo';

const ChassisScrews: React.FC<{ tone?: ShellTone }> = ({ tone = 'dark' }) => {
  const outer =
    tone === 'graphite'
      ? 'bg-[#2A2D37] border-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.85)]'
      : tone === 'indigo'
        ? 'bg-[#1A163D] border-indigo-200/25 shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]'
        : 'bg-[#090810] border-white/[0.12] shadow-[inset_0_1px_2px_rgba(0,0,0,0.92)]';

  const slot =
    tone === 'indigo' ? 'bg-indigo-200/35' : 'bg-white/25';

  return (
    <>
      {[
        'top-2.5 left-2.5',
        'top-2.5 right-2.5',
        'bottom-2.5 left-2.5',
        'bottom-2.5 right-2.5',
      ].map((pos, idx) => (
        <span
          key={idx}
          aria-hidden="true"
          className={`pointer-events-none absolute ${pos} w-2 h-2 rounded-full border flex items-center justify-center z-20 ${outer}`}
        >
          <span className={`w-1 h-[1px] rotate-45 block ${slot}`} />
        </span>
      ))}
    </>
  );
};

/** Physical drilled dot-matrix speaker grille */
const DrilledSpeakerGrille: React.FC<{
  tone?: ShellTone;
  className?: string;
  cols?: number;
}> = ({ tone = 'dark', className = '', cols = 5 }) => {
  const dotStyle =
    tone === 'indigo'
      ? 'bg-[#0D0A24]/90 shadow-[0_1px_0_rgba(165,180,252,0.22)]'
      : 'bg-black/95 shadow-[0_1px_0_rgba(255,255,255,0.14)]';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none grid gap-[3px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <span key={i} className={`w-[3px] h-[3px] rounded-full ${dotStyle}`} />
      ))}
    </div>
  );
};

/**
 * Geometrically guaranteed 3×3 CSS Grid diamond pod.
 * Eliminates absolute-positioning drift or vertical stacking across every viewport.
 */
interface FaceDiamondProps {
  top: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  bottom: React.ReactNode;
  center?: React.ReactNode;
  podClassName?: string;
  backdrop?: React.ReactNode;
}

const FaceDiamond: React.FC<FaceDiamondProps> = ({
  top,
  left,
  right,
  bottom,
  center,
  podClassName = 'w-[152px] h-[152px] p-1.5 bg-[#090810] border border-white/10 shadow-[inset_0_4px_16px_rgba(0,0,0,0.9)]',
  backdrop,
}) => (
  <div
    className={`relative shrink-0 grid grid-cols-3 grid-rows-3 place-items-center rounded-full ${podClassName}`}
  >
    {backdrop}
    <div className="col-start-2 row-start-1 flex items-center justify-center z-10">
      {top}
    </div>
    <div className="col-start-1 row-start-2 flex items-center justify-center z-10">
      {left}
    </div>
    <div className="col-start-2 row-start-2 flex items-center justify-center pointer-events-none z-10">
      {center ?? (
        <span className="w-4 h-4 rounded-full border border-white/10 bg-black/35 flex items-center justify-center">
          <span className="w-1 h-1 rounded-full bg-white/30" />
        </span>
      )}
    </div>
    <div className="col-start-3 row-start-2 flex items-center justify-center z-10">
      {right}
    </div>
    <div className="col-start-2 row-start-3 flex items-center justify-center z-10">
      {bottom}
    </div>
  </div>
);

/** Hardware shell colorway presets shared across Landscape & Portrait */
function getShellTheme(layout: ControllerLayoutId): {
  tone: ShellTone;
  shellBg: string;
  shellTexture: string;
  wellClass: string;
  silkPrimary: string;
  silkMuted: string;
  modelCode: string;
  accentHex: string;
} {
  switch (layout) {
    case 'nes':
      return {
        tone: 'dark',
        shellBg:
          'bg-gradient-to-b from-[#23252D] via-[#171920] to-[#101218] border border-white/12 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.12),inset_0_-3px_0_rgba(0,0,0,0.75),0_18px_38px_rgba(0,0,0,0.82)]',
        shellTexture: 'controller-grip-texture-dark',
        wellClass:
          'bg-[#0B0C11] border border-white/10 shadow-[inset_0_3px_12px_rgba(0,0,0,0.92)]',
        silkPrimary: 'text-[#F5F4F0]',
        silkMuted: 'text-white/50',
        modelCode: 'NES // HVC-001',
        accentHex: '#E52521',
      };
    case 'snes':
      return {
        tone: 'graphite',
        shellBg:
          'bg-gradient-to-b from-[#3E424F] via-[#2E323D] to-[#21242D] border border-white/16 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.2),inset_0_-3px_0_rgba(0,0,0,0.65),0_18px_38px_rgba(0,0,0,0.78)]',
        shellTexture: 'controller-grip-texture-dark',
        wellClass:
          'bg-[#1B1E26] border border-white/12 shadow-[inset_0_3px_12px_rgba(0,0,0,0.85)]',
        silkPrimary: 'text-[#F5F4F0]',
        silkMuted: 'text-slate-300/65',
        modelCode: 'SNES // SHVC-005',
        accentHex: '#3B82F6',
      };
    case 'gba':
      return {
        tone: 'indigo',
        shellBg:
          'bg-gradient-to-b from-[#423A8C] via-[#2F286B] to-[#1F1A4B] border border-indigo-200/20 shadow-[inset_0_2px_0_rgba(199,210,254,0.28),inset_0_-3px_0_rgba(10,8,28,0.6),0_18px_38px_rgba(0,0,0,0.78)]',
        shellTexture: 'gba-pcb-traces',
        wellClass:
          'bg-[#18143B]/85 border border-indigo-200/15 shadow-[inset_0_3px_10px_rgba(0,0,0,0.65)]',
        silkPrimary: 'text-[#E8EAFA]',
        silkMuted: 'text-indigo-200/70',
        modelCode: 'GBA // AGB-001',
        accentHex: '#34D399',
      };
    case 'genesis':
      return {
        tone: 'dark',
        shellBg:
          'bg-gradient-to-b from-[#1C1E26] via-[#13151B] to-[#0B0C11] border border-white/10 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.1),inset_0_-3px_0_rgba(0,0,0,0.8),0_18px_38px_rgba(0,0,0,0.85)]',
        shellTexture: 'controller-grip-texture-dark',
        wellClass:
          'bg-[#08090D] border border-white/10 shadow-[inset_0_3px_12px_rgba(0,0,0,0.95)]',
        silkPrimary: 'text-[#F5F4F0]',
        silkMuted: 'text-white/50',
        modelCode: 'GENESIS // MK-1653',
        accentHex: '#FF3B1D',
      };
    case 'n64':
      return {
        tone: 'dark',
        shellBg:
          'bg-gradient-to-b from-[#20222C] via-[#161820] to-[#0E1016] border border-[#FACC15]/20 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14),inset_0_-3px_0_rgba(0,0,0,0.72),0_18px_38px_rgba(0,0,0,0.84)]',
        shellTexture: 'controller-grip-texture-dark',
        wellClass:
          'bg-[#0A0B10] border border-white/10 shadow-[inset_0_3px_12px_rgba(0,0,0,0.92)]',
        silkPrimary: 'text-[#F5F4F0]',
        silkMuted: 'text-slate-300/60',
        modelCode: 'N64 // NUS-005',
        accentHex: '#FACC15',
      };
    case 'dualstick':
    default:
      return {
        tone: 'dark',
        shellBg:
          'bg-gradient-to-b from-[#171623] via-[#100F19] to-[#0B0A12] border border-white/12 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14),inset_0_-3px_0_rgba(0,0,0,0.78),0_20px_44px_rgba(0,0,0,0.88)]',
        shellTexture: 'controller-grip-texture-dark',
        wellClass:
          'bg-[#08070E] border border-white/10 shadow-[inset_0_4px_14px_rgba(0,0,0,0.92)]',
        silkPrimary: 'text-[#F5F4F0]',
        silkMuted: 'text-white/50',
        modelCode: 'COUCH PRO // MK-II',
        accentHex: '#FF3B5C',
      };
  }
}

const ControllerDeckImpl: React.FC<ControllerDeckProps> = ({
  layout,
  playerColor,
  playerSlot = 0,
  hapticsEnabled,
  soundClicks = false,
  isPortrait = false,
  gameTitle,
  gameControls,
  gameAccent,
  rumbleActive = false,
  onButtonChange,
  onDirectionsChange,
  onStickChange,
}) => {
  // Track simultaneous N64 C-buttons so releasing one never clears another
  const cPadRef = useRef({ up: false, down: false, left: false, right: false });
  const latestStickRef = useRef(onStickChange);
  latestStickRef.current = onStickChange;

  useEffect(() => {
    cPadRef.current = { up: false, down: false, left: false, right: false };
  }, [layout]);

  const handleCButton = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right', pressed: boolean) => {
      cPadRef.current[dir] = pressed;
      const { up, down, left, right } = cPadRef.current;
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const y = (down ? 1 : 0) - (up ? 1 : 0);
      latestStickRef.current('right', x, y);
    },
    [],
  );

  const shell = getShellTheme(layout);
  const themeAccent = gameAccent ?? shell.accentHex;
  const deckMeta = CONTROLLER_LAYOUT_META[layout];
  const playerTag = `P${playerSlot + 1}`;

  const rumbleStyle: React.CSSProperties | undefined = rumbleActive
    ? {
        borderColor: themeAccent,
        boxShadow: `inset 0 0 0 2px ${themeAccent}cc, 0 0 28px ${themeAccent}66, 0 18px 36px rgba(0,0,0,0.82)`,
      }
    : undefined;

  // =========================================================================
  // SHARED REUSABLE RIGHT-HAND CLUSTERS (Guaranteed Geometry in BOTH Orientations)
  // =========================================================================

  /** 1. COUCH PRO — Obsidian Midnight 3×3 Grid ABXY Diamond */
  const renderProDiamond = (compact = false) => {
    const btnSize = compact
      ? 'w-[44px] h-[44px] text-base'
      : 'w-[46px] h-[46px] sm:w-[50px] sm:h-[50px] md:w-[54px] md:h-[54px] text-base sm:text-lg';
    const podSize = compact
      ? 'w-[144px] h-[144px] p-1.5'
      : 'w-[min(42vw,152px)] h-[min(42vw,152px)] sm:w-[162px] sm:h-[162px] md:w-[174px] md:h-[174px] p-1.5';

    return (
      <FaceDiamond
        podClassName={`${podSize} bg-gradient-to-b from-[#0D0C16] to-[#07060C] border border-white/12 shadow-[inset_0_5px_18px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.08)]`}
        center={
          <span className="w-4 h-4 rounded-full border border-white/12 bg-white/[0.03] flex items-center justify-center">
            <span
              style={{
                backgroundColor: playerColor,
                boxShadow: `0 0 6px ${playerColor}`,
              }}
              className="w-1.5 h-1.5 rounded-full opacity-80"
            />
          </span>
        }
        top={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.NORTH}
            label="Y"
            accentColor="#FFB800"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.12}
            className={`${btnSize} bg-gradient-to-b from-[#2B283A] via-[#1B1926] to-[#11101A] border-2 border-[#FFB800] text-white shadow-[0_0_10px_rgba(255,184,0,0.22)]`}
          />
        }
        left={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.WEST}
            label="X"
            accentColor="#22D3EE"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.96}
            className={`${btnSize} bg-gradient-to-b from-[#2B283A] via-[#1B1926] to-[#11101A] border-2 border-[#22D3EE] text-white shadow-[0_0_10px_rgba(34,211,238,0.22)]`}
          />
        }
        right={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.EAST}
            label="B"
            accentColor="#FF3B5C"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.06}
            className={`${btnSize} bg-gradient-to-b from-[#2B283A] via-[#1B1926] to-[#11101A] border-2 border-[#FF3B5C] text-white shadow-[0_0_10px_rgba(255,59,92,0.24)]`}
          />
        }
        bottom={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.SOUTH}
            label="A"
            accentColor="#34D399"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.9}
            className={`${btnSize} bg-gradient-to-b from-[#2B283A] via-[#1B1926] to-[#11101A] border-2 border-[#34D399] text-white shadow-[0_0_10px_rgba(52,211,153,0.24)]`}
          />
        }
      />
    );
  };

  /** 2. SNES — Classic 4-Jewel 3×3 Grid Diamond inside Tilted Pill Cradle */
  const renderSnesDiamond = (compact = false) => {
    const btnSize = compact
      ? 'w-[44px] h-[44px] text-base'
      : 'w-[48px] h-[48px] sm:w-[52px] sm:h-[52px] md:w-[56px] md:h-[56px] text-lg sm:text-xl';
    const podSize = compact
      ? 'w-[146px] h-[146px] p-1.5'
      : 'w-[min(42vw,162px)] h-[min(42vw,162px)] sm:w-[172px] sm:h-[172px] md:w-[184px] md:h-[184px] p-2';

    return (
      <FaceDiamond
        podClassName={`${podSize} bg-gradient-to-b from-[#232630] to-[#171921] border-2 border-white/14 shadow-[inset_0_5px_16px_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.12)] overflow-hidden`}
        backdrop={
          <>
            {/* Iconic Super Famicom tilted dark-gray recessed pill inlays */}
            <span className="pointer-events-none absolute top-[17%] left-[10%] w-[58%] h-[28%] -rotate-[42deg] rounded-full bg-white/[0.06] border border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]" />
            <span className="pointer-events-none absolute bottom-[17%] right-[10%] w-[58%] h-[28%] -rotate-[42deg] rounded-full bg-white/[0.06] border border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]" />
          </>
        }
        center={
          <span className="w-3.5 h-3.5 rounded-full border border-white/12 bg-black/45" />
        }
        top={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.NORTH}
            label="X"
            concave
            accentColor="#2563EB"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.12}
            className={`${btnSize} bg-gradient-to-b from-[#3B82F6] via-[#2563EB] to-[#1D4ED8] border-2 border-[#0E1016] text-white`}
          />
        }
        left={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.WEST}
            label="Y"
            concave
            accentColor="#16A34A"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.95}
            className={`${btnSize} bg-gradient-to-b from-[#22C55E] via-[#16A34A] to-[#15803D] border-2 border-[#0E1016] text-white`}
          />
        }
        right={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.EAST}
            label="A"
            accentColor="#E11D48"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.06}
            className={`${btnSize} bg-gradient-to-b from-[#F43F5E] via-[#E11D48] to-[#BE123C] border-2 border-[#0E1016] text-white`}
          />
        }
        bottom={
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.SOUTH}
            label="B"
            accentColor="#F59E0B"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.9}
            className={`${btnSize} bg-gradient-to-b from-[#FBBF24] via-[#F59E0B] to-[#D97706] border-2 border-[#0E1016] text-[#141412]`}
          />
        }
      />
    );
  };

  /** 3. NES — Clean Horizontal Glossy Crimson B & A Pair inside Crisp Square Bezel Wells */
  const renderNesButtons = (compact = false) => {
    const btnSize = compact
      ? 'w-[54px] h-[54px] min-[390px]:w-[60px] min-[390px]:h-[60px] text-xl'
      : 'w-[60px] h-[60px] sm:w-[68px] sm:h-[68px] md:w-[76px] md:h-[76px] text-2xl';
    const wellPad = compact ? 'p-1.5' : 'p-2';

    return (
      <div
        className={`flex items-center ${compact ? 'gap-2.5 px-2.5 py-3' : 'gap-4 sm:gap-5 px-4 py-4'} rounded-[24px] bg-[#0B0C11] border border-white/12 shadow-[inset_0_4px_14px_rgba(0,0,0,0.92)]`}
      >
        <div className="flex flex-col items-center gap-1.5 mt-1.5">
          <div
            className={`${wellPad} rounded-2xl bg-[#181A22] border-2 border-[#E5E3DC]/80 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]`}
          >
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.SOUTH}
              label="B"
              concave
              accentColor="#E52521"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.95}
              className={`${btnSize} bg-gradient-to-b from-[#FF453A] via-[#E52521] to-[#A61411] border-2 border-[#0B0C10] text-white`}
            />
          </div>
          <span className="font-brand font-extrabold text-xs tracking-[0.2em] text-[#FF453A]">
            B
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5 -mt-1.5">
          <div
            className={`${wellPad} rounded-2xl bg-[#181A22] border-2 border-[#E5E3DC]/80 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]`}
          >
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.EAST}
              label="A"
              concave
              accentColor="#E52521"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={1.06}
              className={`${btnSize} bg-gradient-to-b from-[#FF453A] via-[#E52521] to-[#A61411] border-2 border-[#0B0C10] text-white`}
            />
          </div>
          <span className="font-brand font-extrabold text-xs tracking-[0.2em] text-[#FF453A]">
            A
          </span>
        </div>
      </div>
    );
  };

  /** 4. GBA — Authentic Angled B (lower-left) & A (upper-right) Pair in Sculpted Oval Cradle */
  const renderGbaButtons = (compact = false) => {
    const btnSize = compact
      ? 'w-[56px] h-[56px] min-[390px]:w-[62px] min-[390px]:h-[62px] text-xl'
      : 'w-[62px] h-[62px] sm:w-[68px] sm:h-[68px] md:w-[76px] md:h-[76px] text-2xl';

    return (
      <div
        className={`flex items-center ${compact ? 'gap-3.5 px-3.5 py-4' : 'gap-4 sm:gap-5 px-5 py-5'} rounded-full bg-[#17133B]/90 border-2 border-indigo-200/18 shadow-[inset_0_4px_14px_rgba(0,0,0,0.68)]`}
      >
        <div className="mt-5">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.SOUTH}
            label="B"
            concave
            accentColor="#34D399"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.95}
            className={`${btnSize} bg-gradient-to-b from-[#F0F2F9] via-[#D7DAE5] to-[#B4B9C9] border-2 border-[#121024] text-[#1A1C28]`}
          />
        </div>
        <div className="-mt-5">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.EAST}
            label="A"
            concave
            accentColor="#34D399"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.06}
            className={`${btnSize} bg-gradient-to-b from-[#F0F2F9] via-[#D7DAE5] to-[#B4B9C9] border-2 border-[#121024] text-[#1A1C28]`}
          />
        </div>
      </div>
    );
  };

  /** 5. GENESIS — Iconic Curved 2-Row 6-Button Fighting Arc */
  const renderGenesisButtons = (compact = false) => {
    const topSize = compact
      ? 'w-[40px] h-[40px] min-[390px]:w-[44px] min-[390px]:h-[44px] text-sm'
      : 'w-[46px] h-[46px] sm:w-[50px] sm:h-[50px] md:w-[54px] md:h-[54px] text-base';
    const botSize = compact
      ? 'w-[46px] h-[46px] min-[390px]:w-[50px] min-[390px]:h-[50px] text-base'
      : 'w-[54px] h-[54px] sm:w-[58px] sm:h-[58px] md:w-[64px] md:h-[64px] text-xl';

    return (
      <div
        className={`flex flex-col ${compact ? 'px-2.5 py-3' : 'px-4 py-4'} rounded-[28px] bg-[#08090D] border border-white/14 shadow-[inset_0_4px_16px_rgba(0,0,0,0.95),0_0_24px_rgba(255,59,29,0.08)]`}
      >
        {/* Top Row: X, Y (raised arc), Z — silver-rimmed dark tactile caps */}
        <div className="flex items-end gap-2 sm:gap-2.5 -ml-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L1}
            label="X"
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.1}
            className={`${topSize} bg-gradient-to-b from-[#3E4250] via-[#262933] to-[#171920] border-2 border-slate-300/45 text-white`}
          />
          <div className="-translate-y-1.5">
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.NORTH}
              label="Y"
              accentColor="#FF3B1D"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={1.15}
              className={`${topSize} bg-gradient-to-b from-[#3E4250] via-[#262933] to-[#171920] border-2 border-slate-300/45 text-white`}
            />
          </div>
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R1}
            label="Z"
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.2}
            className={`${topSize} bg-gradient-to-b from-[#3E4250] via-[#262933] to-[#171920] border-2 border-slate-300/45 text-white`}
          />
        </div>

        {/* Bottom Row: A, B (raised arc), C — larger glossy black-with-chrome-ring caps */}
        <div className="flex items-start gap-2 sm:gap-2.5 mt-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.WEST}
            label="A"
            concave
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.92}
            className={`${botSize} bg-gradient-to-b from-[#2A2D38] via-[#14161D] to-[#090A0E] border-2 border-white/55 text-[#FF5757]`}
          />
          <div className="-translate-y-1.5">
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.SOUTH}
              label="B"
              concave
              accentColor="#FF3B1D"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.98}
              className={`${botSize} bg-gradient-to-b from-[#2A2D38] via-[#14161D] to-[#090A0E] border-2 border-white/55 text-[#FF5757]`}
            />
          </div>
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.EAST}
            label="C"
            concave
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.04}
            className={`${botSize} bg-gradient-to-b from-[#2A2D38] via-[#14161D] to-[#090A0E] border-2 border-white/55 text-[#FF5757]`}
          />
        </div>
      </div>
    );
  };

  /** 6A. N64 — Compact 3×3 Grid Yellow C-Button Diamond */
  const renderN64CPod = (compact = false) => {
    const btnSize = compact
      ? 'w-[30px] h-[30px] text-[10px]'
      : 'w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] text-[11px]';
    const podSize = compact
      ? 'w-[104px] h-[104px] p-1'
      : 'w-[104px] h-[104px] sm:w-[116px] sm:h-[116px] p-1';

    return (
      <FaceDiamond
        podClassName={`${podSize} bg-[#0A0B10] border border-[#FACC15]/35 shadow-[inset_0_4px_12px_rgba(0,0,0,0.92)]`}
        center={
          <span className="font-brand font-extrabold text-[10px] text-[#FACC15]/60">
            C
          </span>
        }
        top={
          <DirectionalAxisButton
            label="C▲"
            onPressChange={(p) => handleCButton('up', p)}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.18}
            className={`${btnSize} bg-gradient-to-b from-[#FDE047] via-[#FACC15] to-[#CA8A04] border border-[#0B0C10] text-[#141412] font-extrabold`}
          />
        }
        left={
          <DirectionalAxisButton
            label="C◀"
            onPressChange={(p) => handleCButton('left', p)}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.12}
            className={`${btnSize} bg-gradient-to-b from-[#FDE047] via-[#FACC15] to-[#CA8A04] border border-[#0B0C10] text-[#141412] font-extrabold`}
          />
        }
        right={
          <DirectionalAxisButton
            label="C▶"
            onPressChange={(p) => handleCButton('right', p)}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.15}
            className={`${btnSize} bg-gradient-to-b from-[#FDE047] via-[#FACC15] to-[#CA8A04] border border-[#0B0C10] text-[#141412] font-extrabold`}
          />
        }
        bottom={
          <DirectionalAxisButton
            label="C▼"
            onPressChange={(p) => handleCButton('down', p)}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={1.08}
            className={`${btnSize} bg-gradient-to-b from-[#FDE047] via-[#FACC15] to-[#CA8A04] border border-[#0B0C10] text-[#141412] font-extrabold`}
          />
        }
      />
    );
  };

  /** 6B. N64 — Angled Green B & Large Cobalt Blue A Pair */
  const renderN64BAPair = (compact = false) => (
    <div
      className={`flex items-center ${compact ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5'} rounded-full bg-[#0A0B10]/90 border border-white/10 shadow-[inset_0_3px_10px_rgba(0,0,0,0.88)]`}
    >
      <div className="-mt-4">
        <TactileButton
          buttonIndex={GAMEPAD_BUTTON.WEST}
          label="B"
          accentColor="#10B981"
          onButtonChange={onButtonChange}
          hapticsEnabled={hapticsEnabled}
          soundClicks={soundClicks}
          clickPitch={0.96}
          className={`${compact ? 'w-[48px] h-[48px] text-lg' : 'w-[52px] h-[52px] sm:w-[56px] sm:h-[56px] text-xl'} bg-gradient-to-b from-[#22C55E] via-[#16A34A] to-[#15803D] border-2 border-[#090A0E] text-white`}
        />
      </div>
      <div className="mt-4">
        <TactileButton
          buttonIndex={GAMEPAD_BUTTON.SOUTH}
          label="A"
          accentColor="#2563EB"
          onButtonChange={onButtonChange}
          hapticsEnabled={hapticsEnabled}
          soundClicks={soundClicks}
          clickPitch={1.05}
          className={`${compact ? 'w-[56px] h-[56px] text-xl' : 'w-[60px] h-[60px] sm:w-[66px] sm:h-[66px] text-2xl'} bg-gradient-to-b from-[#3B82F6] via-[#2563EB] to-[#1D4ED8] border-2 border-[#090A0E] text-white`}
        />
      </div>
    </div>
  );

  // =========================================================================
  // 1. PORTRAIT MODE — Ergonomic Handheld Deck (All 6 Profiles)
  // =========================================================================
  if (isPortrait) {
    const lcdTextColor = gameAccent ?? '#B5FF2A';

    const shoulderDark =
      'bg-gradient-to-b from-[#282738] to-[#14131E] border border-white/16 text-[#F5F4F0]';
    const shoulderSnes =
      'bg-gradient-to-b from-[#555A6B] to-[#343844] border border-white/20 text-[#F5F4F0]';
    const shoulderGba =
      'bg-gradient-to-b from-[#ECEEF5] to-[#BFC4D4] border-2 border-[#121024] text-[#1A1C28]';

    const pillBtnClass =
      layout === 'gba'
        ? 'bg-gradient-to-b from-[#E6E8F2] to-[#BCC0D0] border-2 border-[#121024] text-[#181A24]'
        : 'bg-gradient-to-b from-[#2A293B] to-[#151420] border border-white/16 text-[#F5F4F0]';

    return (
      <div
        style={rumbleStyle}
        className={`controller-surface ${shell.shellTexture} ${shell.shellBg} relative w-full h-full flex flex-col justify-between px-3 pt-2.5 pb-2 rounded-[28px] overflow-hidden transition-shadow duration-150 ${
          rumbleActive ? 'animate-chassis-rumble' : ''
        }`}
      >
        <ChassisScrews tone={shell.tone} />

        {/* Top Console Signature Accent Bar */}
        {layout === 'dualstick' && (
          <div
            style={{
              backgroundColor: playerColor,
              boxShadow: `0 0 16px ${playerColor}aa`,
            }}
            className="pointer-events-none absolute top-0 left-12 right-12 h-1.5 rounded-b-full"
          />
        )}
        {layout === 'nes' && (
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-1.5 bg-[#E52521]" />
        )}
        {layout === 'genesis' && (
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#FF3B1D] to-transparent" />
        )}
        {layout === 'snes' && (
          <div className="pointer-events-none absolute top-0 left-10 right-10 h-1 smpte-bar rounded-b-full opacity-90" />
        )}

        {/* Compact Top OLED Status Strip */}
        <div className="relative z-10 rounded-[18px] bg-[#0B0A12]/90 border border-white/10 p-2 shadow-[inset_0_2px_10px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between gap-2 px-0.5 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: playerColor,
                  boxShadow: `0 0 8px ${playerColor}`,
                }}
              />
              <span className="font-mono-tech text-[9px] font-bold uppercase tracking-[0.18em] text-white/60 truncate">
                {playerTag} · {shell.modelCode}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                style={{
                  borderColor: `${lcdTextColor}50`,
                  color: lcdTextColor,
                  backgroundColor: `${lcdTextColor}14`,
                }}
                className="px-1.5 py-[1px] rounded border font-mono-tech text-[8px] font-extrabold uppercase tracking-wider"
              >
                {deckMeta.shortLabel}
              </span>
              <DrilledSpeakerGrille tone={shell.tone} cols={4} />
            </div>
          </div>

          <div className="relative rounded-lg crt-well px-2.5 py-1.5 overflow-hidden flex items-center justify-between gap-2">
            <div className="lcd-pixel-grid absolute inset-0 opacity-65" />
            <div className="relative z-10 min-w-0 flex-1">
              <div
                style={{
                  color: lcdTextColor,
                  textShadow: `0 0 10px ${lcdTextColor}55`,
                }}
                className="font-brand text-xs font-extrabold truncate leading-tight"
              >
                {gameTitle || 'COUCH·OS HANDSET'}
              </div>
              <div className="font-mono-tech text-[8.5px] text-white/55 truncate mt-0.5">
                {gameControls || deckMeta.description}
              </div>
            </div>
            <span className="relative z-10 shrink-0 inline-flex items-center gap-1 px-1.5 py-[3px] rounded bg-black/40 border border-white/10 font-osd text-[14px] leading-none text-white/85">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C] tv-blink shadow-[0_0_6px_#FF3B5C]" />
              LIVE
            </span>
          </div>
        </div>

        {/* Shoulders Row */}
        {(layout === 'dualstick' ||
          layout === 'snes' ||
          layout === 'gba' ||
          layout === 'n64') && (
          <div className="relative z-10 flex items-center justify-between gap-2 mt-2">
            {layout === 'dualstick' ? (
              <>
                <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#07060C] border border-white/10">
                  <TactileButton
                    buttonIndex={GAMEPAD_BUTTON.L2}
                    label="L2"
                    shape="bumper"
                    accentColor={playerColor}
                    onButtonChange={onButtonChange}
                    hapticsEnabled={hapticsEnabled}
                    soundClicks={soundClicks}
                    clickPitch={0.82}
                    className={`w-13 h-8 text-[11px] font-mono-tech ${shoulderDark}`}
                  />
                  <TactileButton
                    buttonIndex={GAMEPAD_BUTTON.L1}
                    label="L1"
                    shape="bumper"
                    accentColor={playerColor}
                    onButtonChange={onButtonChange}
                    hapticsEnabled={hapticsEnabled}
                    soundClicks={soundClicks}
                    clickPitch={0.92}
                    className={`w-14 h-8 text-[11px] font-mono-tech ${shoulderDark}`}
                  />
                </div>
                <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#07060C] border border-white/10">
                  <TactileButton
                    buttonIndex={GAMEPAD_BUTTON.R1}
                    label="R1"
                    shape="bumper"
                    accentColor={playerColor}
                    onButtonChange={onButtonChange}
                    hapticsEnabled={hapticsEnabled}
                    soundClicks={soundClicks}
                    clickPitch={0.92}
                    className={`w-14 h-8 text-[11px] font-mono-tech ${shoulderDark}`}
                  />
                  <TactileButton
                    buttonIndex={GAMEPAD_BUTTON.R2}
                    label="R2"
                    shape="bumper"
                    accentColor={playerColor}
                    onButtonChange={onButtonChange}
                    hapticsEnabled={hapticsEnabled}
                    soundClicks={soundClicks}
                    clickPitch={0.82}
                    className={`w-13 h-8 text-[11px] font-mono-tech ${shoulderDark}`}
                  />
                </div>
              </>
            ) : layout === 'n64' ? (
              <>
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.L1}
                  label="L"
                  shape="bumper"
                  accentColor="#FACC15"
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.88}
                  className={`w-20 h-9 text-xs font-mono-tech ${shoulderDark}`}
                />
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.L2}
                  label="Z"
                  shape="pill"
                  accentColor="#FF3B5C"
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.78}
                  className="w-24 h-9 bg-gradient-to-b from-[#FF4D6A] via-[#E11D48] to-[#9F1239] border border-rose-200/35 text-white text-xs font-mono-tech font-extrabold tracking-widest"
                />
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.R1}
                  label="R"
                  shape="bumper"
                  accentColor="#FACC15"
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.88}
                  className={`w-20 h-9 text-xs font-mono-tech ${shoulderDark}`}
                />
              </>
            ) : (
              <>
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.L1}
                  label="L"
                  shape="bumper"
                  accentColor={shell.accentHex}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.88}
                  className={`w-28 h-9 text-xs font-mono-tech font-extrabold ${
                    layout === 'gba' ? shoulderGba : shoulderSnes
                  }`}
                />
                <span
                  className={`font-mono-tech text-[9px] font-bold uppercase tracking-[0.2em] ${shell.silkMuted}`}
                >
                  {layout === 'snes' ? 'SHVC' : 'ADVANCE'}
                </span>
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.R1}
                  label="R"
                  shape="bumper"
                  accentColor={shell.accentHex}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.88}
                  className={`w-28 h-9 text-xs font-mono-tech font-extrabold ${
                    layout === 'gba' ? shoulderGba : shoulderSnes
                  }`}
                />
              </>
            )}
          </div>
        )}

        {/* PORTRAIT BODY PER PROFILE */}
        {layout === 'dualstick' ? (
          /* Dualstick Portrait: Upper row D-Pad + 3×3 ABXY Diamond, Lower row Twin Sticks + SELECT/START centered */
          <div className="relative z-10 flex-1 flex flex-col justify-evenly gap-2 py-1 min-h-0">
            <div className="flex items-center justify-between gap-2">
              <TouchDPad
                upIndex={GAMEPAD_BUTTON.DPAD_UP}
                downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
                leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
                rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
                onDirectionsChange={onDirectionsChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                accentColor={playerColor}
                tone="dark"
                sizeClass="w-[128px] h-[128px] min-[390px]:w-[138px] min-[390px]:h-[138px]"
              />
              {renderProDiamond(true)}
            </div>

            <div className="flex items-center justify-between gap-1.5">
              <AnalogStick
                label="L"
                accentColor={playerColor}
                ringColor={playerColor}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                floatingCenter
                sizeClass="w-[104px] h-[104px] min-[390px]:w-[114px] min-[390px]:h-[114px]"
                onChange={(x, y) => onStickChange('left', x, y)}
              />

              {/* Centered SELECT / LED / START stack */}
              <div className="flex flex-col items-center gap-2 px-2 py-2.5 rounded-2xl bg-[#090810] border border-white/10">
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.SELECT}
                  label="SELECT"
                  shape="pill"
                  accentColor={playerColor}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.8}
                  className={`w-16 h-6 text-[8px] font-mono-tech font-extrabold tracking-widest ${pillBtnClass}`}
                />
                <span
                  style={{
                    backgroundColor: playerColor,
                    boxShadow: `0 0 10px ${playerColor}`,
                  }}
                  className="w-8 h-1 rounded-full"
                />
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.START}
                  label="START"
                  shape="pill"
                  accentColor={playerColor}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.85}
                  className={`w-16 h-6 text-[8px] font-mono-tech font-extrabold tracking-widest ${pillBtnClass}`}
                />
              </div>

              <AnalogStick
                label="R"
                accentColor={playerColor}
                ringColor="#22D3EE"
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                floatingCenter
                sizeClass="w-[104px] h-[104px] min-[390px]:w-[114px] min-[390px]:h-[114px]"
                onChange={(x, y) => onStickChange('right', x, y)}
              />
            </div>
          </div>
        ) : layout === 'n64' ? (
          /* N64 Portrait: Upper D-Pad + C-Pod Diamond, Lower Octagonal Stick + Red START + Green B / Blue A */
          <div className="relative z-10 flex-1 flex flex-col justify-evenly gap-2 py-1 min-h-0">
            <div className="flex items-center justify-between gap-2 px-1">
              <TouchDPad
                upIndex={GAMEPAD_BUTTON.DPAD_UP}
                downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
                leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
                rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
                onDirectionsChange={onDirectionsChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                accentColor="#FACC15"
                tone="dark"
                sizeClass="w-[116px] h-[116px] min-[390px]:w-[126px] min-[390px]:h-[126px]"
              />
              {renderN64CPod(true)}
            </div>

            <div className="flex items-center justify-between gap-2">
              <AnalogStick
                label="3D"
                accentColor="#FACC15"
                gate="octagonal"
                capTone="light"
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                floatingCenter
                sizeClass="w-[114px] h-[114px] min-[390px]:w-[124px] min-[390px]:h-[124px]"
                onChange={(x, y) => onStickChange('left', x, y)}
              />

              <TactileButton
                buttonIndex={GAMEPAD_BUTTON.START}
                label="START"
                shape="circle"
                accentColor="#E11D48"
                onButtonChange={onButtonChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                clickPitch={0.84}
                className="w-12 h-12 bg-gradient-to-b from-[#FB3B5B] via-[#E11D48] to-[#9F1239] border-2 border-[#0B0C10] text-white text-[8px] font-mono-tech font-extrabold tracking-wider shrink-0"
              />

              {renderN64BAPair(true)}
            </div>
          </div>
        ) : (
          /* NES, SNES, GBA, Genesis Portrait: Primary Thumb Row + Bottom SELECT/START Bridge */
          <>
            <div className="relative z-10 flex-1 flex items-center justify-between gap-2 py-2 min-h-0">
              <TouchDPad
                upIndex={GAMEPAD_BUTTON.DPAD_UP}
                downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
                leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
                rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
                onDirectionsChange={onDirectionsChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                accentColor={shell.accentHex}
                tone={layout === 'gba' ? 'light' : 'dark'}
                styleVariant={layout === 'genesis' ? 'saucer' : 'cross'}
                sizeClass="w-[130px] h-[130px] min-[390px]:w-[144px] min-[390px]:h-[144px]"
              />

              <div className="flex items-center justify-center shrink-0">
                {layout === 'nes' && renderNesButtons(true)}
                {layout === 'gba' && renderGbaButtons(true)}
                {layout === 'snes' && renderSnesDiamond(true)}
                {layout === 'genesis' && renderGenesisButtons(true)}
              </div>
            </div>

            {/* Bottom Recessed SELECT / START Bridge */}
            <div className="relative z-10 flex items-center justify-center pb-1">
              <div
                className={`flex items-center gap-3.5 px-4 py-2 rounded-full ${shell.wellClass}`}
              >
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.SELECT}
                  label={layout === 'genesis' ? 'MODE' : 'SELECT'}
                  shape="pill"
                  accentColor={shell.accentHex}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.8}
                  className={`w-20 h-7 text-[9px] font-mono-tech font-extrabold tracking-widest ${pillBtnClass}`}
                />
                <span
                  style={{
                    backgroundColor: playerColor,
                    boxShadow: `0 0 8px ${playerColor}`,
                  }}
                  className="w-2 h-2 rounded-full border border-black/40"
                />
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.START}
                  label="START"
                  shape="pill"
                  accentColor={shell.accentHex}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.84}
                  className={`w-20 h-7 text-[9px] font-mono-tech font-extrabold tracking-widest ${pillBtnClass}`}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // =========================================================================
  // 2. LANDSCAPE MODE — 6 AUTHENTIC ERGONOMIC CONSOLE HARDWARE DECKS
  // =========================================================================
  const baseShellClass = `controller-surface ${shell.shellTexture} ${shell.shellBg} relative w-full h-full flex flex-col justify-between p-2.5 sm:p-4 rounded-[28px] overflow-hidden transition-shadow duration-150 ${
    rumbleActive ? 'animate-chassis-rumble' : ''
  }`;

  // -------------------------------------------------------------------------
  // 2A. NES — Classic Dark-Faceplate NES / Famicom Edition
  // -------------------------------------------------------------------------
  if (layout === 'nes') {
    return (
      <div style={rumbleStyle} className={baseShellClass}>
        <ChassisScrews tone="dark" />

        {/* Iconic Dark Faceplate Top Bar with Crimson Stripe */}
        <div className="relative z-10 mx-1 sm:mx-2 rounded-2xl bg-[#0D0E14] border border-white/10 overflow-hidden shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)]">
          <div className="h-1.5 w-full bg-[#E52521]" />
          <div className="flex items-center justify-between px-3 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: playerColor,
                  boxShadow: `0 0 8px ${playerColor}`,
                }}
              />
              <span className="font-brand font-extrabold text-[11px] tracking-[0.16em] text-[#F5F4F0] uppercase truncate">
                NES · FAMICOM EDITION
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {gameTitle && (
                <span className="hidden sm:inline font-mono-tech text-[10px] text-[#FF453A] font-bold uppercase tracking-wider truncate max-w-[170px]">
                  {gameTitle}
                </span>
              )}
              <DrilledSpeakerGrille tone="dark" cols={5} />
            </div>
          </div>
        </div>

        {/* Main NES Deck */}
        <div className="relative z-10 flex-1 flex items-center justify-between gap-2 px-1 sm:px-4 min-h-0">
          {/* Left: Crisp Cross D-Pad */}
          <div className="p-2 rounded-full bg-[#0E1016] border border-white/10 shadow-[inset_0_3px_10px_rgba(0,0,0,0.85)]">
            <TouchDPad
              upIndex={GAMEPAD_BUTTON.DPAD_UP}
              downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
              leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
              rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
              onDirectionsChange={onDirectionsChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              accentColor="#E52521"
              tone="dark"
              sizeClass="w-36 h-36 md:w-44 md:h-44"
            />
          </div>

          {/* Center: Classic Horizontal Stripes + Recessed Rubber SELECT / START */}
          <div className="flex flex-col items-center justify-end gap-2.5 self-stretch pb-1 min-w-0 max-w-[205px]">
            <div className="hidden sm:flex flex-col gap-1.5 w-36">
              <div className="h-2 rounded-full bg-[#2B2E3A] border border-white/10" />
              <div className="h-2 rounded-full bg-[#2B2E3A] border border-white/10" />
              <div className="h-1.5 rounded-full bg-[#E52521] shadow-[0_0_10px_rgba(229,37,33,0.45)]" />
              <div className="h-2 rounded-full bg-[#2B2E3A] border border-white/10" />
            </div>

            <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-[#0B0C11] border border-white/12 shadow-[inset_0_3px_10px_rgba(0,0,0,0.9)]">
              <div className="flex flex-col items-center gap-1">
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.SELECT}
                  label=""
                  ariaLabel="Select"
                  shape="pill"
                  accentColor="#E52521"
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.8}
                  className="w-13 sm:w-15 h-5 bg-gradient-to-b from-[#3E414E] to-[#1E2028] border border-white/20"
                />
                <span className="font-mono-tech text-[8.5px] font-extrabold tracking-[0.18em] text-[#FF453A]">
                  SELECT
                </span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.START}
                  label=""
                  ariaLabel="Start"
                  shape="pill"
                  accentColor="#E52521"
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.85}
                  className="w-13 sm:w-15 h-5 bg-gradient-to-b from-[#3E414E] to-[#1E2028] border border-white/20"
                />
                <span className="font-mono-tech text-[8.5px] font-extrabold tracking-[0.18em] text-[#FF453A]">
                  START
                </span>
              </div>
            </div>
          </div>

          {/* Right: Clean Horizontal Glossy Crimson B & A Pair in Square Bezel Wells */}
          {renderNesButtons(false)}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2B. GBA — Atomic Translucent Indigo Pocket Deck
  // -------------------------------------------------------------------------
  if (layout === 'gba') {
    return (
      <div style={rumbleStyle} className={baseShellClass}>
        <ChassisScrews tone="indigo" />

        {/* Subtle internal translucent PCB trace border & gold test vias */}
        <div className="pointer-events-none absolute inset-4 rounded-[20px] border border-indigo-300/15" />
        <span className="pointer-events-none absolute top-14 left-12 w-2 h-2 rounded-full bg-amber-300/35 ring-2 ring-amber-200/15" />
        <span className="pointer-events-none absolute bottom-12 right-16 w-2 h-2 rounded-full bg-amber-300/35 ring-2 ring-amber-200/15" />

        {/* Top Row: Wide Translucent Light-Gray L & R Shoulders + Emerald POWER LED */}
        <div className="relative z-10 flex justify-between items-center px-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L1}
            label="L"
            shape="bumper"
            accentColor="#34D399"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.86}
            className="w-28 sm:w-36 h-9 bg-gradient-to-b from-[#ECEEF5]/95 via-[#D6D8E4]/90 to-[#B7BCCB]/90 border-2 border-[#121024] text-[#1A1C28] text-sm font-mono-tech font-extrabold"
          />

          <div className="flex items-center gap-2.5 px-3 py-1 rounded-full bg-[#161238]/85 border border-indigo-200/20">
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full bg-[#34D399]"
                style={{ boxShadow: '0 0 10px #34D399' }}
              />
              <span className="font-mono-tech text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                POWER
              </span>
            </span>
            <span className="w-[1px] h-3 bg-indigo-200/20" />
            <span className="font-brand text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-100/85">
              ADVANCE 32
            </span>
            <DrilledSpeakerGrille
              tone="indigo"
              cols={4}
              className="hidden sm:grid"
            />
          </div>

          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R1}
            label="R"
            shape="bumper"
            accentColor="#34D399"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.86}
            className="w-28 sm:w-36 h-9 bg-gradient-to-b from-[#ECEEF5]/95 via-[#D6D8E4]/90 to-[#B7BCCB]/90 border-2 border-[#121024] text-[#1A1C28] text-sm font-mono-tech font-extrabold"
          />
        </div>

        {/* Main GBA Deck */}
        <div className="relative z-10 flex-1 flex items-center justify-between gap-2 px-2 sm:px-5 min-h-0">
          <TouchDPad
            upIndex={GAMEPAD_BUTTON.DPAD_UP}
            downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
            leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
            rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
            onDirectionsChange={onDirectionsChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            accentColor="#34D399"
            tone="light"
            sizeClass="w-36 h-36 md:w-44 md:h-44"
          />

          <div className="flex flex-col items-center justify-end gap-2 self-stretch pb-1 min-w-0 max-w-[190px]">
            {(gameTitle || gameControls) && (
              <div className="hidden sm:flex flex-col items-center px-3 py-1.5 rounded-xl bg-[#131030]/85 border border-indigo-200/20 max-w-full">
                <div className="flex items-center gap-1.5 max-w-full">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: '#34D399',
                      boxShadow: '0 0 7px #34D399',
                    }}
                  />
                  <span className="font-display text-[11px] font-bold text-indigo-50 truncate">
                    {gameTitle}
                  </span>
                </div>
                {gameControls && (
                  <span className="font-mono-tech text-[9px] text-indigo-200/60 truncate max-w-full mt-0.5">
                    {gameControls}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-[#18143B]/85 border border-indigo-200/18 shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]">
              <TactileButton
                buttonIndex={GAMEPAD_BUTTON.SELECT}
                label="SELECT"
                shape="pill"
                accentColor="#34D399"
                onButtonChange={onButtonChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                clickPitch={0.8}
                className="w-14 sm:w-16 h-6 bg-gradient-to-b from-[#E3E5EE] to-[#BCC0CE] border-2 border-[#121024] text-[8px] font-mono-tech font-extrabold tracking-widest text-[#1B1D29]"
              />
              <TactileButton
                buttonIndex={GAMEPAD_BUTTON.START}
                label="START"
                shape="pill"
                accentColor="#34D399"
                onButtonChange={onButtonChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                clickPitch={0.85}
                className="w-14 sm:w-16 h-6 bg-gradient-to-b from-[#E3E5EE] to-[#BCC0CE] border-2 border-[#121024] text-[8px] font-mono-tech font-extrabold tracking-widest text-[#1B1D29]"
              />
            </div>
          </div>

          {/* Right: Authentic Angled GBA B (lower-left) & A (upper-right) Pair */}
          {renderGbaButtons(false)}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2C. SNES — Super Famicom / SNES Pro Graphite-Silver
  // -------------------------------------------------------------------------
  if (layout === 'snes') {
    return (
      <div style={rumbleStyle} className={baseShellClass}>
        <ChassisScrews tone="graphite" />

        {/* Top Row: Wide Curved L & R Bumpers + 4-Color Super Famicom Emblem */}
        <div className="relative z-10 flex justify-between items-center px-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L1}
            label="L"
            shape="bumper"
            accentColor="#3B82F6"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.86}
            className="w-28 sm:w-36 h-9 rounded-tl-3xl rounded-tr-xl bg-gradient-to-b from-[#5A5F70] via-[#414554] to-[#2E313D] border border-white/20 text-[#F5F4F0] text-sm font-mono-tech font-extrabold"
          />

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1 -skew-x-12">
              <span className="w-2 h-2 rounded-full bg-[#E11D48] shadow-[0_0_6px_rgba(225,29,72,0.5)]" />
              <span className="w-2 h-2 rounded-full bg-[#F59E0B] shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
              <span className="w-2 h-2 rounded-full bg-[#16A34A] shadow-[0_0_6px_rgba(22,163,74,0.5)]" />
              <span className="w-2 h-2 rounded-full bg-[#2563EB] shadow-[0_0_6px_rgba(37,99,235,0.5)]" />
            </div>
            <span className="font-brand text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#F5F4F0]">
              SUPER PRO
            </span>
          </div>

          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R1}
            label="R"
            shape="bumper"
            accentColor="#E11D48"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.86}
            className="w-28 sm:w-36 h-9 rounded-tr-3xl rounded-tl-xl bg-gradient-to-b from-[#5A5F70] via-[#414554] to-[#2E313D] border border-white/20 text-[#F5F4F0] text-sm font-mono-tech font-extrabold"
          />
        </div>

        {/* Main SNES Deck */}
        <div className="relative z-10 flex-1 flex items-center justify-between gap-2 px-1 sm:px-4 min-h-0">
          {/* Left: Recessed Circular Well + Classic SNES D-Pad */}
          <div className="p-2 rounded-full bg-[#1E212A] border border-white/12 shadow-[inset_0_4px_12px_rgba(0,0,0,0.75)]">
            <TouchDPad
              upIndex={GAMEPAD_BUTTON.DPAD_UP}
              downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
              leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
              rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
              onDirectionsChange={onDirectionsChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              accentColor={playerColor}
              tone="dark"
              sizeClass="w-36 h-36 md:w-44 md:h-44"
            />
          </div>

          {/* Center: SMPTE 4-Color Accent + Angled Rubber SELECT / START Pills */}
          <div className="flex flex-col items-center justify-end gap-2.5 self-stretch pb-1 min-w-0 max-w-[190px]">
            <div className="hidden sm:flex flex-col items-center gap-1.5 w-full">
              <div className="w-28 h-1 rounded-full smpte-bar opacity-90" />
              {(gameTitle || gameControls) && (
                <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-[#1A1D25]/90 border border-white/10 max-w-full">
                  <span className="font-display text-[11px] font-bold text-[#F5F4F0] truncate max-w-full">
                    {gameTitle}
                  </span>
                  {gameControls && (
                    <span className="font-mono-tech text-[9px] text-slate-300/65 truncate max-w-full">
                      {gameControls}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 px-3 py-2">
              <div className="flex flex-col items-center gap-1.5">
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.SELECT}
                  label=""
                  ariaLabel="Select"
                  shape="pill"
                  accentColor={playerColor}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.8}
                  className="w-13 sm:w-15 h-5 bg-gradient-to-b from-[#555A68] to-[#2B2E38] border border-white/20 -rotate-[24deg]"
                />
                <span className="font-mono-tech text-[8px] font-extrabold tracking-[0.18em] text-slate-300/75 mt-0.5">
                  SELECT
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <TactileButton
                  buttonIndex={GAMEPAD_BUTTON.START}
                  label=""
                  ariaLabel="Start"
                  shape="pill"
                  accentColor={playerColor}
                  onButtonChange={onButtonChange}
                  hapticsEnabled={hapticsEnabled}
                  soundClicks={soundClicks}
                  clickPitch={0.85}
                  className="w-13 sm:w-15 h-5 bg-gradient-to-b from-[#555A68] to-[#2B2E38] border border-white/20 -rotate-[24deg]"
                />
                <span className="font-mono-tech text-[8px] font-extrabold tracking-[0.18em] text-slate-300/75 mt-0.5">
                  START
                </span>
              </div>
            </div>
          </div>

          {/* Right: 4-Jewel 3×3 Grid Diamond inside Tilted Pill Cradle */}
          {renderSnesDiamond(false)}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2D. GENESIS — 6-Button Obsidian Fighting Pad
  // -------------------------------------------------------------------------
  if (layout === 'genesis') {
    return (
      <div style={rumbleStyle} className={baseShellClass}>
        <ChassisScrews tone="dark" />

        {/* Molded Ribbed Side Grip Accents */}
        <div className="pointer-events-none absolute left-0 top-14 bottom-14 w-2.5 grip-ribs opacity-40" />
        <div className="pointer-events-none absolute right-0 top-14 bottom-14 w-2.5 grip-ribs opacity-40" />

        {/* Vermilion Sega Pinstripe */}
        <div className="pointer-events-none absolute top-[50px] left-5 right-5 h-[1.5px] bg-gradient-to-r from-transparent via-[#FF3B1D] to-transparent opacity-80" />

        {/* Top Row: MODE & START + Arcade Badge */}
        <div className="relative z-10 flex justify-between items-center px-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.SELECT}
            label="MODE"
            shape="bumper"
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.82}
            className="w-24 h-8 bg-gradient-to-b from-[#2B2E38] to-[#13151B] border border-white/15 text-slate-200 text-[10px] font-mono-tech font-extrabold tracking-widest"
          />

          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full bg-[#FF3B1D] shrink-0"
              style={{ boxShadow: '0 0 8px #FF3B1D' }}
            />
            <span className="font-brand text-[11px] font-extrabold uppercase tracking-[0.2em] text-white/85 truncate">
              {gameTitle || '16-BIT FIGHT PAD'}
            </span>
          </div>

          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.START}
            label="START"
            shape="bumper"
            accentColor="#FF3B1D"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.86}
            className="w-24 h-8 bg-gradient-to-b from-[#2B2E38] to-[#13151B] border border-[#FF3B1D]/55 text-[#FF5757] text-[10px] font-mono-tech font-extrabold tracking-widest"
          />
        </div>

        {/* Main Genesis Deck: Floating 8-Way Saucer D-Pad + Curved 6-Button Fighting Arc */}
        <div className="relative z-10 flex-1 flex items-center justify-between gap-2 px-2 sm:px-5 min-h-0">
          <TouchDPad
            upIndex={GAMEPAD_BUTTON.DPAD_UP}
            downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
            leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
            rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
            onDirectionsChange={onDirectionsChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            accentColor="#FF3B1D"
            tone="dark"
            styleVariant="saucer"
            sizeClass="w-38 h-38 md:w-44 md:h-44"
          />

          {renderGenesisButtons(false)}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2E. N64 — Obsidian & Gold Octagonal Trident Deck
  // -------------------------------------------------------------------------
  if (layout === 'n64') {
    return (
      <div style={rumbleStyle} className={baseShellClass}>
        <ChassisScrews tone="dark" />

        {/* Subtle Trident Center Seam */}
        <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-gradient-to-b from-[#FACC15]/25 via-white/[0.04] to-transparent" />

        {/* Top Row: L, Central Crimson Z Trigger Pill, R */}
        <div className="relative z-10 flex justify-between items-center gap-2 px-2">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L1}
            label="L"
            shape="bumper"
            accentColor="#FACC15"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.88}
            className="w-22 sm:w-28 h-9 bg-gradient-to-b from-[#3A3E4C] to-[#1D202A] border border-white/15 text-white text-xs font-mono-tech font-extrabold"
          />

          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline font-mono-tech text-[9px] font-bold uppercase tracking-[0.2em] text-[#FACC15]/70">
              TRIDENT 64
            </span>
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.L2}
              label="Z TRIGGER"
              shape="pill"
              accentColor="#FF3B5C"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.78}
              className="w-26 sm:w-32 h-9 bg-gradient-to-b from-[#FF4D6A] via-[#E11D48] to-[#9F1239] border border-rose-200/35 text-white text-[10px] font-mono-tech font-extrabold tracking-widest"
            />
          </div>

          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R1}
            label="R"
            shape="bumper"
            accentColor="#FACC15"
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.88}
            className="w-22 sm:w-28 h-9 bg-gradient-to-b from-[#3A3E4C] to-[#1D202A] border border-white/15 text-white text-xs font-mono-tech font-extrabold"
          />
        </div>

        {/* Main N64 Deck: D-Pad upper-left + Octagonal Stick lower-center-left | Red START | B/A lower-left + C-Pod upper-right */}
        <div className="relative z-10 flex-1 flex items-center justify-between gap-1.5 sm:gap-3 px-1 sm:px-3 min-h-0">
          {/* Left Cluster: D-Pad (upper-left) + Octagonal 3D Stick (lower-center-left) */}
          <div className="flex items-stretch gap-2 sm:gap-3 h-full max-h-[210px] py-1">
            <div className="self-start">
              <TouchDPad
                upIndex={GAMEPAD_BUTTON.DPAD_UP}
                downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
                leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
                rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
                onDirectionsChange={onDirectionsChange}
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                accentColor="#FACC15"
                tone="dark"
                sizeClass="w-[96px] h-[96px] sm:w-[108px] sm:h-[108px] md:w-[116px] md:h-[116px]"
              />
            </div>
            <div className="self-end">
              <AnalogStick
                label="3D"
                accentColor="#FACC15"
                gate="octagonal"
                capTone="light"
                hapticsEnabled={hapticsEnabled}
                soundClicks={soundClicks}
                sizeClass="w-[110px] h-[110px] sm:w-[124px] sm:h-[124px] md:w-[136px] md:h-[136px]"
                onChange={(x, y) => onStickChange('left', x, y)}
              />
            </div>
          </div>

          {/* Center: Iconic Red Circular START Button */}
          <div className="flex flex-col items-center justify-center gap-1.5 shrink-0">
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.START}
              label="START"
              shape="circle"
              accentColor="#E11D48"
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.85}
              className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-b from-[#FB3B5B] via-[#E11D48] to-[#9F1239] border-2 border-[#0B0C10] text-white text-[9px] font-mono-tech font-extrabold tracking-wider"
            />
            <span className="font-mono-tech text-[8px] font-bold uppercase tracking-[0.2em] text-white/40">
              {playerTag}
            </span>
          </div>

          {/* Right Cluster: Green B + Large Blue A (lower-left) & Yellow 3×3 C-Pod (upper-right) */}
          <div className="flex items-stretch gap-2 sm:gap-3 h-full max-h-[210px] py-1">
            <div className="self-end">{renderN64BAPair(false)}</div>
            <div className="self-start">{renderN64CPod(false)}</div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2F. DUAL-STICK PRO — COUCH PRO Obsidian Midnight Switch Pro / DualSense Hybrid
  // -------------------------------------------------------------------------
  return (
    <div style={rumbleStyle} className={baseShellClass}>
      <ChassisScrews tone="dark" />

      {/* Top Glowing Player LED Lightbar */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-44 sm:w-64 h-2 rounded-b-full bg-[#06050A] p-[2px] z-20 border-x border-b border-white/10">
        <div
          style={{
            backgroundColor: playerColor,
            boxShadow: `0 0 18px ${playerColor}, 0 2px 12px ${playerColor}99`,
          }}
          className="w-full h-full rounded-b-full"
        />
      </div>

      {/* Top Row: Machined Dark-Metal Trigger Wells (L2/L1 & R1/R2) */}
      <div className="relative z-10 flex justify-between items-center gap-2 px-1 pt-1">
        <div className="flex gap-1.5 p-1 rounded-2xl bg-[#07060C] border border-white/10 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L2}
            label="L2"
            shape="bumper"
            accentColor={playerColor}
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.82}
            className="w-14 sm:w-20 h-9 bg-gradient-to-b from-[#232234] to-[#12111C] border border-white/15 text-[#F5F4F0] text-xs font-mono-tech font-extrabold"
          />
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.L1}
            label="L1"
            shape="bumper"
            accentColor={playerColor}
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.92}
            className="w-15 sm:w-22 h-9 bg-gradient-to-b from-[#2E2D42] to-[#191826] border border-white/18 text-white text-xs font-mono-tech font-extrabold"
          />
        </div>

        <span className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#090810] border border-white/10 font-mono-tech text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/60">
          <span
            style={{
              backgroundColor: playerColor,
              boxShadow: `0 0 8px ${playerColor}`,
            }}
            className="w-1.5 h-1.5 rounded-full"
          />
          {gameTitle || 'COUCH PRO'}
        </span>

        <div className="flex gap-1.5 p-1 rounded-2xl bg-[#07060C] border border-white/10 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]">
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R1}
            label="R1"
            shape="bumper"
            accentColor={playerColor}
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.92}
            className="w-15 sm:w-22 h-9 bg-gradient-to-b from-[#2E2D42] to-[#191826] border border-white/18 text-white text-xs font-mono-tech font-extrabold"
          />
          <TactileButton
            buttonIndex={GAMEPAD_BUTTON.R2}
            label="R2"
            shape="bumper"
            accentColor={playerColor}
            onButtonChange={onButtonChange}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            clickPitch={0.82}
            className="w-14 sm:w-20 h-9 bg-gradient-to-b from-[#232234] to-[#12111C] border border-white/15 text-[#F5F4F0] text-xs font-mono-tech font-extrabold"
          />
        </div>
      </div>

      {/* Main COUCH PRO Deck — Authentic Switch Pro / Xbox Staggered Geometry */}
      <div className="relative z-10 flex-1 flex items-center justify-between gap-1.5 sm:gap-3 px-1 sm:px-3 min-h-0">
        {/* Left Cluster: Large Left Analog Stick (upper-outer-left) + Sculpted D-Pad (lower-inner-left) */}
        <div className="flex items-stretch gap-1.5 sm:gap-3 h-full max-h-[214px] py-1">
          <div className="self-start">
            <AnalogStick
              label="L"
              accentColor={playerColor}
              ringColor={playerColor}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              sizeClass="w-[108px] h-[108px] sm:w-[122px] sm:h-[122px] md:w-[136px] md:h-[136px]"
              onChange={(x, y) => onStickChange('left', x, y)}
            />
          </div>
          <div className="self-end">
            <TouchDPad
              upIndex={GAMEPAD_BUTTON.DPAD_UP}
              downIndex={GAMEPAD_BUTTON.DPAD_DOWN}
              leftIndex={GAMEPAD_BUTTON.DPAD_LEFT}
              rightIndex={GAMEPAD_BUTTON.DPAD_RIGHT}
              onDirectionsChange={onDirectionsChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              accentColor={playerColor}
              tone="dark"
              sizeClass="w-[94px] h-[94px] sm:w-[106px] sm:h-[106px] md:w-[116px] md:h-[116px]"
            />
          </div>
        </div>

        {/* Center Recessed Console Bridge: Player LED Pill + SELECT/START + Speaker Vents */}
        <div className="flex flex-col items-center justify-center gap-2.5 px-2.5 sm:px-3.5 py-3 rounded-2xl bg-[#090810]/90 border border-white/10 shadow-[inset_0_3px_12px_rgba(0,0,0,0.92)] shrink-0">
          {/* Glowing Player LED Pill */}
          <div className="flex flex-col items-center gap-1">
            <span
              style={{
                borderColor: `${playerColor}66`,
                color: playerColor,
                backgroundColor: `${playerColor}16`,
                boxShadow: `0 0 12px ${playerColor}33`,
              }}
              className="px-2.5 py-0.5 rounded-full border font-mono-tech text-[10px] font-extrabold tracking-widest"
            >
              {playerTag}
            </span>
            <span
              style={{
                backgroundColor: playerColor,
                boxShadow: `0 0 10px ${playerColor}`,
              }}
              className="w-8 h-[3px] rounded-full"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2">
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.SELECT}
              label="SELECT"
              shape="pill"
              accentColor={playerColor}
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.8}
              className="w-14 h-6 bg-gradient-to-b from-[#2A293B] to-[#151420] border border-white/16 text-[8px] font-mono-tech font-extrabold tracking-wider text-[#F5F4F0]"
            />
            <TactileButton
              buttonIndex={GAMEPAD_BUTTON.START}
              label="START"
              shape="pill"
              accentColor={playerColor}
              onButtonChange={onButtonChange}
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              clickPitch={0.85}
              className="w-14 h-6 bg-gradient-to-b from-[#2A293B] to-[#151420] border border-white/16 text-[8px] font-mono-tech font-extrabold tracking-wider text-[#F5F4F0]"
            />
          </div>

          <DrilledSpeakerGrille tone="dark" cols={5} />
        </div>

        {/* Right Cluster: Right Analog Stick (lower-inner-right) + 3×3 Grid ABXY Diamond (upper-outer-right) */}
        <div className="flex items-stretch gap-1.5 sm:gap-3 h-full max-h-[214px] py-1">
          <div className="self-end">
            <AnalogStick
              label="R"
              accentColor="#22D3EE"
              ringColor="#22D3EE"
              hapticsEnabled={hapticsEnabled}
              soundClicks={soundClicks}
              sizeClass="w-[94px] h-[94px] sm:w-[106px] sm:h-[106px] md:w-[116px] md:h-[116px]"
              onChange={(x, y) => onStickChange('right', x, y)}
            />
          </div>
          <div className="self-start">{renderProDiamond(false)}</div>
        </div>
      </div>
    </div>
  );
};

/**
 * Memoised so page-level state (latency readouts, toasts, room updates) never
 * re-renders the deck; it only re-renders when its own props change.
 */
export const ControllerDeck = React.memo(ControllerDeckImpl);
