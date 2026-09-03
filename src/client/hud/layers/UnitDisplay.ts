import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { ToggleStructureEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  BOMB_TYPES,
  BOMBS,
  loadSelectedBomb,
  loadSelectedShipIdx,
  saveSelectedBomb,
  saveSelectedShipIdx,
  SHIP_TYPES,
  SHIPS,
} from "../BuildTabs";
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const oilStorageIcon = assetUrl("images/OilStorageIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const defensePostIcon = assetUrl("images/ShieldIconWhite.svg");
const wallIcon = assetUrl("images/WallIconWhite.svg");
const oilPumpIcon = assetUrl("images/OilPumpIconWhite.svg");
const tollStationIcon = assetUrl("images/TollStationIconWhite.svg");
const emergencyStationIcon = assetUrl("images/EmergencyStationIconWhite.svg");
const lighthouseIcon = assetUrl("images/LighthouseIconWhite.svg");

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private _wall = 0;
  private _oilPump = 0;
  private _oilStorage = 0;
  private _waterTollStation = 0;
  private _emergencyStation = 0;
  private _lighthouse = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private _hoveredBomb: PlayerBuildableUnitType | null = null;
  private bombMenuOpen = false;
  private selectedBomb: PlayerBuildableUnitType = loadSelectedBomb();
  private _hoveredShip: number | null = null;
  private shipsMenuOpen = false;
  private selectedShipIdx: number = loadSelectedShipIdx();

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  // `knownCost` overrides the type's own price — warship hull classes are
  // flat-priced and must not be gated on the (fleet-size-dependent) base
  // warship price.
  private canBuild(item: UnitType, knownCost?: Gold): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    const price = knownCost ?? this.cost(item);
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.ElectricBomb:
      case UnitType.MIRV:
        // Only a FINISHED silo enables bombs — greyed while it's still building.
        return (
          price <= (player?.gold() ?? 0n) &&
          (player
            ?.units(UnitType.MissileSilo)
            .some((u) => !u.isUnderConstruction()) ??
            false)
        );
      case UnitType.Warship:
      case UnitType.FishingBoat:
      case UnitType.PatrolBoat:
      case UnitType.Submarine:
      case UnitType.AtomicSubmarine:
      case UnitType.WaterTollStation:
        // All ships and the toll station need a FINISHED port (ships launch
        // from one), so grey them out until a port is built.
        return (
          price <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).some((u) => !u.isUnderConstruction()) ??
            false)
        );
      default:
        return price <= (player?.gold() ?? 0n);
    }
  }

  // Full price of a ships-tab entry: warship hull classes have their own
  // flat price; everything else uses the normal buildable cost.
  private shipCost(entry: (typeof SHIPS)[number]): Gold {
    if (entry.type === UnitType.Warship && entry.shipClass !== null) {
      const player = this.game?.myPlayer();
      if (player) {
        return this.game.config().warshipClassCost(entry.shipClass, player);
      }
    }
    return this.cost(entry.type);
  }

  private canBuildShip(entry: (typeof SHIPS)[number]): boolean {
    return this.canBuild(entry.type, this.shipCost(entry));
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this._wall = player.totalUnitLevels(UnitType.Wall);
    this._oilPump = player.totalUnitLevels(UnitType.OilPump);
    this._oilStorage = player.totalUnitLevels(UnitType.OilStorage);
    this._waterTollStation = player.totalUnitLevels(UnitType.WaterTollStation);
    this._emergencyStation = player.totalUnitLevels(UnitType.EmergencyStation);
    this._lighthouse = player.totalUnitLevels(UnitType.Lighthouse);
    // Close a fly-out once something outside it gets armed elsewhere (bar
    // click, hotkey, build menu).
    const g = this.uiState.ghostStructure;
    if (this.bombMenuOpen && g !== null && !BOMB_TYPES.has(g)) {
      this.bombMenuOpen = false;
    }
    if (this.shipsMenuOpen && g !== null && !SHIP_TYPES.has(g)) {
      this.shipsMenuOpen = false;
    }
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    return html`
      <div class="border-t border-white/10 p-0.5 w-full">
        <div class="flex flex-wrap justify-center gap-0.5 w-full">
          ${this.renderUnitItem(
            cityIcon,
            this._cities,
            UnitType.City,
            "city",
            this.keybinds["buildCity"]?.key ?? "1",
          )}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
            this.keybinds["buildFactory"]?.key ?? "2",
          )}
          ${this.renderUnitItem(
            portIcon,
            this._port,
            UnitType.Port,
            "port",
            this.keybinds["buildPort"]?.key ?? "3",
          )}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense_post",
            this.keybinds["buildDefensePost"]?.key ?? "4",
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile_silo",
            this.keybinds["buildMissileSilo"]?.key ?? "5",
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "sam_launcher",
            this.keybinds["buildSamLauncher"]?.key ?? "6",
          )}
          ${this.renderShipsButton()} ${this.renderBombButton()}
          ${this.renderUnitItem(
            wallIcon,
            this._wall,
            UnitType.Wall,
            "wall",
            "Alt 1",
          )}
          ${this.renderUnitItem(
            oilPumpIcon,
            this._oilPump,
            UnitType.OilPump,
            "oil_pump",
            "Alt 2",
          )}
          ${this.renderUnitItem(
            oilStorageIcon,
            this._oilStorage,
            UnitType.OilStorage,
            "oil_storage",
            "Alt 4",
          )}
          ${this.renderUnitItem(
            tollStationIcon,
            this._waterTollStation,
            UnitType.WaterTollStation,
            "water_toll_station",
            "Alt 3",
          )}
          ${this.renderUnitItem(
            emergencyStationIcon,
            this._emergencyStation,
            UnitType.EmergencyStation,
            "emergency_station",
            "Alt 5",
          )}
          ${this.renderUnitItem(
            lighthouseIcon,
            this._lighthouse,
            UnitType.Lighthouse,
            "lighthouse",
            "Alt 6",
          )}
        </div>
      </div>
    `;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText("unit_type." + structureKey)}${hotkey
                    ? ` [${displayHotkey}]`
                    : ""}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                ${unitType === UnitType.Warship
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
                    >
                      ⇧ ${translateText("build_menu.warship_shift_hint")}
                    </div>`
                  : null}
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}"
          @click=${() => {
            if (selected) {
              this.uiState.ghostStructure = null;
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${hotkey
            ? html`<div
                class="ml-0.5 text-[10px] relative -top-1 text-gray-400"
              >
                ${displayHotkey}
              </div>`
            : html`<div class="ml-0.5"></div>`}
          <div class="flex items-center gap-0.5 pt-0.5">
            <img src=${icon} alt=${structureKey} class="align-middle size-5" />
            ${number !== null
              ? html`<span class="text-xs">${renderNumber(number)}</span>`
              : null}
          </div>
        </div>
      </div>
    `;
  }

  private isBombArmed(): boolean {
    const g = this.uiState.ghostStructure;
    return g !== null && BOMB_TYPES.has(g);
  }

  // The two grouped tabs are mutually exclusive: opening one always closes the
  // other, so they never overlap on the bar.
  private toggleBombMenu() {
    this.bombMenuOpen = !this.bombMenuOpen;
    if (this.bombMenuOpen) this.shipsMenuOpen = false;
    this.requestUpdate();
  }

  private toggleShipsMenu() {
    this.shipsMenuOpen = !this.shipsMenuOpen;
    if (this.shipsMenuOpen) this.bombMenuOpen = false;
    this.requestUpdate();
  }

  /** Display form of a keybind, e.g. "Digit7" → "7". */
  private hotkeyLabel(action: string, fallback: string): string {
    return (this.keybinds[action]?.key ?? fallback)
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();
  }

  private isShipArmed(): boolean {
    const g = this.uiState.ghostStructure;
    return g !== null && SHIP_TYPES.has(g);
  }

  private selectShip(idx: number) {
    this.selectedShipIdx = idx;
    saveSelectedShipIdx(idx);
    const entry = SHIPS[idx];
    if (this.canBuildShip(entry)) {
      this.uiState.ghostStructure = entry.type;
      this.uiState.ghostShipClass = entry.shipClass;
    }
    this.shipsMenuOpen = false;
    this.requestUpdate();
  }

  // Single "Ships" bar item that opens a sub-menu of every buyable ship
  // (fishing boat, patrol boat, the three warship hulls, both submarines).
  private renderShipsButton() {
    const cfg = this.game.config();
    const ships = SHIPS.map((s, i) => ({ ...s, idx: i })).filter(
      (s) => !cfg.isUnitDisabled(s.type),
    );
    if (ships.length === 0) return html``;
    const armed = this.isShipArmed();
    const sel = ships.find((s) => s.idx === this.selectedShipIdx) ?? ships[0];
    return html`
      <div class="flex flex-col items-center relative">
        ${this.shipsMenuOpen
          ? html`<div
              class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex gap-0.5 p-0.5 bg-gray-800/95 backdrop-blur-sm rounded-md shadow-lg z-[110]"
            >
              ${ships.map((s) => {
                const enabled = this.canBuildShip(s);
                const active = this.selectedShipIdx === s.idx;
                const hovered = this._hoveredShip === s.idx;
                return html`<div
                  class="relative flex"
                  @mouseenter=${() => {
                    this._hoveredShip = s.idx;
                    this.requestUpdate();
                  }}
                  @mouseleave=${() => {
                    this._hoveredShip = null;
                    this.requestUpdate();
                  }}
                >
                  ${hovered
                    ? html`<div
                        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max max-w-56 text-xs bg-gray-800/95 backdrop-blur-xs rounded-sm p-1 z-[120] shadow-lg pointer-events-none"
                      >
                        <div class="font-bold text-sm mb-1">
                          ${translateText("unit_type." + s.key)}
                        </div>
                        <div class="px-1 pb-1">
                          ${translateText("build_menu.desc." + s.key)}
                        </div>
                        <div class="flex items-center justify-center gap-1">
                          <img src=${goldCoinIcon} width="13" height="13" />
                          <span class="text-yellow-300"
                            >${renderNumber(this.shipCost(s))}</span
                          >
                        </div>
                      </div>`
                    : null}
                  <button
                    class="relative w-9 h-9 flex items-center justify-center rounded border transition-colors ${active
                      ? "border-sky-300 bg-sky-400/20"
                      : "border-slate-500 hover:bg-gray-700"} ${enabled
                      ? ""
                      : "opacity-40"}"
                    title=${translateText("unit_type." + s.key)}
                    @click=${() => this.selectShip(s.idx)}
                  >
                    <img src=${s.icon} class="size-5" />
                    ${s.shipClass !== null
                      ? html`<span
                          class="absolute bottom-0 right-0.5 text-[9px] leading-none text-gray-300 pointer-events-none uppercase"
                          >${s.shipClass === "small"
                            ? "S"
                            : s.shipClass === "large"
                              ? "L"
                              : "XL"}</span
                        >`
                      : null}
                  </button>
                </div>`;
              })}
            </div>`
          : null}
        <div
          class="border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer hover:bg-gray-800 text-white ${armed
            ? "bg-slate-400/20"
            : ""}"
          title=${translateText("unit_type.ships")}
          @click=${() => this.toggleShipsMenu()}
        >
          <div class="ml-0.5 text-[10px] relative -top-1 text-gray-400">
            ${this.hotkeyLabel("buildShip", "7")}
          </div>
          <div class="flex items-center gap-0.5 pt-0.5">
            <img src=${sel.icon} alt="ships" class="align-middle size-5" />
          </div>
        </div>
      </div>
    `;
  }

  private selectBomb(type: PlayerBuildableUnitType) {
    this.selectedBomb = type;
    saveSelectedBomb(type);
    if (this.canBuild(type)) {
      this.uiState.ghostStructure = type;
      this.uiState.ghostShipClass = null;
    }
    this.bombMenuOpen = false;
    this.requestUpdate();
  }

  // Single "Bombs" bar item that opens a sub-menu of the four bombs. The button
  // shows the remembered selection and highlights while any bomb is armed.
  private renderBombButton() {
    const cfg = this.game.config();
    const bombs = BOMBS.filter((b) => !cfg.isUnitDisabled(b.type));
    if (bombs.length === 0) return html``;
    const armed = this.isBombArmed();
    const sel = bombs.find((b) => b.type === this.selectedBomb) ?? bombs[0];
    return html`
      <div class="flex flex-col items-center relative">
        ${this.bombMenuOpen
          ? html`<div
              class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex gap-0.5 p-0.5 bg-gray-800/95 backdrop-blur-sm rounded-md shadow-lg z-[110]"
            >
              ${bombs.map((b) => {
                const enabled = this.canBuild(b.type);
                const active = this.selectedBomb === b.type;
                const hovered = this._hoveredBomb === b.type;
                const hotkey = (this.keybinds[b.keybind]?.key ?? b.defaultKey)
                  .replace("Digit", "")
                  .replace("Key", "")
                  .toUpperCase();
                return html`<div
                  class="relative flex"
                  @mouseenter=${() => {
                    this._hoveredBomb = b.type;
                    this.requestUpdate();
                  }}
                  @mouseleave=${() => {
                    this._hoveredBomb = null;
                    this.requestUpdate();
                  }}
                >
                  ${hovered
                    ? html`<div
                        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max text-xs bg-gray-800/95 backdrop-blur-xs rounded-sm p-1 z-[120] shadow-lg pointer-events-none"
                      >
                        <div class="font-bold text-sm mb-1">
                          ${translateText("unit_type." + b.key)}${hotkey
                            ? ` [${hotkey}]`
                            : ""}
                        </div>
                        <div class="flex items-center justify-center gap-1">
                          <img src=${goldCoinIcon} width="13" height="13" />
                          <span class="text-yellow-300"
                            >${renderNumber(this.cost(b.type))}</span
                          >
                        </div>
                      </div>`
                    : null}
                  <button
                    class="relative w-9 h-9 flex items-center justify-center rounded border transition-colors ${active
                      ? "border-sky-300 bg-sky-400/20"
                      : "border-slate-500 hover:bg-gray-700"} ${enabled
                      ? ""
                      : "opacity-40"}"
                    title=${translateText("unit_type." + b.key)}
                    @click=${() => this.selectBomb(b.type)}
                  >
                    <img src=${b.icon} class="size-5" />
                    ${hotkey
                      ? html`<span
                          class="absolute top-0 left-0.5 text-[9px] leading-none text-gray-400 pointer-events-none"
                          >${hotkey}</span
                        >`
                      : null}
                  </button>
                </div>`;
              })}
            </div>`
          : null}
        <div
          class="border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer hover:bg-gray-800 text-white ${armed
            ? "bg-slate-400/20"
            : ""}"
          title=${translateText("unit_type.bombs")}
          @click=${() => this.toggleBombMenu()}
        >
          <div class="ml-0.5 text-[10px] relative -top-1 text-gray-400">
            ${this.hotkeyLabel("buildBomb", "N")}
          </div>
          <div class="flex items-center gap-0.5 pt-0.5">
            <img src=${sel.icon} alt="bombs" class="align-middle size-5" />
          </div>
        </div>
      </div>
    `;
  }
}
