// Renderer types (units, players, tiles, names, config)
export {
  DEFAULT_NUKE_EXPLOSION_COLOR,
  MAX_NUKE_EXPLOSION_COLORS,
  PlayerTypeEnum,
  TrainType,
} from "./Renderer";
export type {
  AllianceData,
  AttackData,
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  EmojiData,
  GhostPreviewData,
  NameEntry,
  NukeExplosionRenderParams,
  NukeTelegraphData,
  NukeTrajectoryData,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
  UnitState,
} from "./Renderer";

// Frame data — boundary contract between game integration and features
export type { FrameData } from "./FrameData";

// Frame events — per-frame ephemeral events (rendering FX)
export type { BonusEvent, FrameEvents } from "./FrameEvents";

// Unit type string constants and derived sets
export {
  ALL_UNIT_TYPES,
  NUKE_MAGNITUDES,
  NUKE_TYPES,
  SMOOTHED_NUKE_TYPES,
  STRUCTURE_TYPES,
  UT_ATOM_BOMB,
  UT_CITY,
  UT_ATOMIC_SUBMARINE,
  UT_DEFENSE_POST,
  UT_ELECTRIC_BOMB,
  UT_EMERGENCY_STATION,
  UT_FACTORY,
  UT_FISHING_BOAT,
  UT_LIGHTHOUSE,
  UT_PATROL_BOAT,
  UT_SUBMARINE,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_OIL_PUMP,
  UT_OIL_STORAGE,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WALL,
  UT_WARSHIP,
  UT_WATER_TOLL_STATION,
} from "./UnitType";
