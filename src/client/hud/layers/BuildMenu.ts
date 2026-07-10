import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { renderNumber } from "../../Utils";
import { GameView } from "../../view";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const electricBombIcon = assetUrl("images/ElectricBombIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const tollStationIcon = assetUrl("images/TollStationIconWhite.svg");
const wallIcon = assetUrl("images/WallIconWhite.svg");
const oilPumpIcon = assetUrl("images/OilPumpIconWhite.svg");
const oilStorageIcon = assetUrl("images/OilStorageIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

// A single row of build buttons — it just gets wider (and scrolls horizontally
// if needed) rather than wrapping onto a second row.
export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.ElectricBomb,
      icon: electricBombIcon,
      description: "build_menu.desc.electric_bomb",
      key: "unit_type.electric_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.WaterTollStation,
      icon: tollStationIcon,
      description: "build_menu.desc.water_toll_station",
      key: "unit_type.water_toll_station",
      countable: true,
    },
    {
      unitType: UnitType.Wall,
      icon: wallIcon,
      description: "build_menu.desc.wall",
      key: "unit_type.wall",
      countable: true,
    },
    {
      unitType: UnitType.OilPump,
      icon: oilPumpIcon,
      description: "build_menu.desc.oil_pump",
      key: "unit_type.oil_pump",
      countable: true,
    },
    {
      unitType: UnitType.OilStorage,
      icon: oilStorageIcon,
      description: "build_menu.desc.oil_storage",
      key: "unit_type.oil_storage",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

// The ordnance types share a single "Bomb" button in the bar; clicking it opens
// a small centred picker to choose which one to launch at the clicked tile.
// Keeps the bar short, groups all bombs together, and gives the (upcoming)
// electric bomb a home. To add a new bomb: add its build-table entry and list
// it here.
const BOMB_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.ElectricBomb,
  UnitType.MIRV,
]);

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
      overflow-x: auto;
    }
    .build-description {
      font-size: 0.6rem;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: nowrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      flex: 0 0 auto;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
    }
    .build-button:not(:disabled):hover {
      background-color: #3a3a3a;
      transform: scale(1.05);
      border-color: #666;
    }
    .build-button:not(:disabled):active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .build-button:disabled {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button:disabled img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost {
      color: #ff4444;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .hidden {
      display: none !important;
    }
    .build-quantity {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 6px;
      color: white;
    }
    .build-quantity button {
      width: 40px;
      height: 40px;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 10px;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
    }
    .build-quantity button:active {
      background-color: #4a4a4a;
    }
    .build-quantity .qty-value {
      font-size: 18px;
      font-weight: bold;
      min-width: 48px;
      text-align: center;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: #2c2c2c;
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid #444;
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button:disabled > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }

    /* Centred bomb picker (opened by the single "Bomb" button). Sits above the
       build menu so it reads as a little pop-over over everything. */
    .bomb-picker-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.4);
    }
    .bomb-picker {
      background-color: #1e1e1e;
      padding: 15px;
      border-radius: 10px;
      box-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      max-width: 95vw;
      max-height: 90vh;
      overflow: auto;
    }
    .bomb-picker .build-row {
      flex-wrap: wrap;
    }
    .bomb-picker-title {
      color: white;
      font-weight: bold;
      font-size: 16px;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: 92px;
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 9px;
      }
      .build-count {
        font-weight: bold;
        font-size: 8px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  // When set, the centred bomb picker is showing over the build menu. It keeps
  // the same clickedTile, so choosing a bomb launches it at that tile.
  @state()
  private _bombPickerOpen = false;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  // Quantity stepper: the touch-friendly alternative to Tab+wheel for placing
  // several copies at once (works on mobile, where there is no scroll wheel).
  private adjustQuantity(delta: number): void {
    const MAX = 25;
    this.uiState.buildQuantity = Math.max(
      1,
      Math.min(MAX, this.uiState.buildQuantity + delta),
    );
    this.requestUpdate();
  }

  private placeCount(type: UnitType): number {
    switch (type) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
      case UnitType.Warship:
        return 1;
      default:
        return Math.max(1, this.uiState.buildQuantity);
    }
  }

  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    const count = this.placeCount(buildableUnit.type);
    if (buildableUnit.canUpgrade !== false) {
      // Quantity stacks an existing structure: one intent per level.
      for (let i = 0; i < count; i++) {
        this.eventBus.emit(
          new SendUpgradeStructureIntentEvent(
            buildableUnit.canUpgrade,
            buildableUnit.type,
          ),
        );
      }
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      // Build and level straight up to the chosen quantity (one intent).
      this.eventBus.emit(
        new BuildUnitIntentEvent(
          buildableUnit.type,
          tile,
          rocketDirectionUp,
          count,
        ),
      );
    }
    this.hideMenu();
  }

  render() {
    // The <build-menu> element is static in the page, so Lit also renders it on
    // the home page / lobby — before the game HUD wires up game + uiState. Bail
    // out until they exist; otherwise reading this.uiState.buildQuantity throws,
    // and a thrown render can abort Lit's whole update batch (which was breaking
    // the game-start flow, leaving it stuck on the loading screen).
    if (!this.uiState || !this.game) {
      return html`<div class="build-menu hidden"></div>`;
    }
    return html`
      ${this.renderBombPicker()}
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="build-quantity" translate="no">
          <button @click=${() => this.adjustQuantity(-1)} aria-label="less">
            −
          </button>
          <span class="qty-value">×${this.uiState.buildQuantity}</span>
          <button @click=${() => this.adjustQuantity(1)} aria-label="more">
            +
          </button>
        </div>
        ${this.filteredBuildTable.map((row) => {
          const others = row.filter(
            (item) => !BOMB_UNIT_TYPES.has(item.unitType),
          );
          const hasBombs = row.some((item) =>
            BOMB_UNIT_TYPES.has(item.unitType),
          );
          return html`
            <div class="build-row">
              ${hasBombs ? this.renderBombLauncherButton() : ""}
              ${others.map((item) => this.renderItemButton(item))}
            </div>
          `;
        })}
      </div>
    `;
  }

  // One build button for a real buildable unit (shared by the main bar and the
  // bomb picker). Returns nothing if the player can't build this type at all.
  private renderItemButton(item: BuildItemDisplay) {
    const buildableUnit = this.playerBuildables?.find(
      (bu) => bu.type === item.unitType,
    );
    if (buildableUnit === undefined) {
      return html``;
    }
    const enabled =
      buildableUnit.canBuild !== false || buildableUnit.canUpgrade !== false;
    return html`
      <button
        class="build-button"
        @click=${() => this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
        ?disabled=${!enabled}
        title=${!enabled ? translateText("build_menu.not_enough_money") : ""}
      >
        <img src=${item.icon} alt="${item.unitType}" width="40" height="40" />
        <span class="build-name">${item.key && translateText(item.key)}</span>
        <span class="build-description"
          >${item.description && translateText(item.description)}</span
        >
        <span class="build-cost" translate="no">
          ${renderNumber(
            this.game && this.game.myPlayer() ? this.cost(item) : 0,
          )}
          <img
            src=${goldCoinIcon}
            alt="gold"
            width="12"
            height="12"
            class="align-middle"
          />
        </span>
        ${item.countable
          ? html`<div class="build-count-chip">
              <span class="build-count">${this.count(item)}</span>
            </div>`
          : buildableUnit.stockpile > 0
            ? html`<div class="build-count-chip">
                <span class="build-count">${buildableUnit.stockpile}</span>
              </div>`
            : ""}
      </button>
    `;
  }

  // The bomb entries that are actually enabled in this game (config may disable
  // some). Drives both whether the launcher button appears and the picker list.
  private bombItems(): BuildItemDisplay[] {
    return flattenedBuildTable.filter(
      (item) =>
        BOMB_UNIT_TYPES.has(item.unitType) &&
        !this.game?.config()?.isUnitDisabled(item.unitType),
    );
  }

  // The single "Bomb" button that stands in for all the ordnance types; opens
  // the picker. Disabled only when no bomb is currently buildable at all.
  private renderBombLauncherButton() {
    const anyEnabled = this.bombItems().some((item) => {
      const bu = this.playerBuildables?.find((b) => b.type === item.unitType);
      return bu ? bu.canBuild !== false || bu.canUpgrade !== false : false;
    });
    return html`
      <button
        class="build-button"
        @click=${() => this.openBombPicker()}
        ?disabled=${!anyEnabled}
        title=${!anyEnabled ? translateText("build_menu.not_enough_money") : ""}
      >
        <img src=${atomBombIcon} alt="bomb" width="40" height="40" />
        <span class="build-name">${translateText("unit_type.bomb")}</span>
        <span class="build-description"
          >${translateText("build_menu.desc.bombs")}</span
        >
      </button>
    `;
  }

  // The centred pop-over that lets you pick which bomb to launch at clickedTile.
  private renderBombPicker() {
    if (this._hidden || !this._bombPickerOpen) {
      return html``;
    }
    return html`
      <div
        class="bomb-picker-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.closeBombPicker();
        }}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="bomb-picker">
          <div class="bomb-picker-title">
            ${translateText("build_menu.select_bomb")}
          </div>
          <div class="build-row">
            ${this.bombItems().map((item) => this.renderItemButton(item))}
          </div>
        </div>
      </div>
    `;
  }

  private openBombPicker() {
    this._bombPickerOpen = true;
    this.requestUpdate();
  }

  private closeBombPicker() {
    this._bombPickerOpen = false;
    this.requestUpdate();
  }

  hideMenu() {
    this._hidden = true;
    this._bombPickerOpen = false;
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this._bombPickerOpen = false;
    this.uiState.buildQuantity = 1; // start each open at a single build
    this.refresh();
  }

  private refresh() {
    this.game
      .myPlayer()
      ?.buildables(this.clickedTile, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
        this.requestUpdate();
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable
      .map((row) =>
        row.filter(
          (item) => !this.game?.config()?.isUnitDisabled(item.unitType),
        ),
      )
      .filter((row) => row.length > 0);
  }

  get isVisible() {
    return !this._hidden;
  }
}
