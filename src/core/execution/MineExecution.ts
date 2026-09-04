import { Execution, Game, Unit, UnitType } from "../game/Game";
import { ResourceType } from "../game/ResourceDeposits";
import { TrainStationExecution } from "./TrainStationExecution";

/**
 * A mine: digs whatever the tile under it holds and piles the output up on
 * site. The pile is only useful once a factory picks it up by rail — see
 * FactoryFreight — which is the whole mine → factory → city/port chain.
 *
 * The seam is finite and shared with the tile (Game.extractResourceAt), so a
 * worked-out patch stays worked out even if the mine is destroyed and rebuilt.
 * Coal seams are deep enough that this barely matters within one game; ore and
 * diamond pockets run dry fast, which is what makes the newly surfacing ones
 * worth chasing.
 */
export class MineExecution implements Execution {
  private active = true;
  private mg: Game;
  private stationCreated = false;

  constructor(private mine: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      // A mine is a rail station like a factory or city, so it can be linked
      // into a network — but it never dispatches trains of its own.
      this.mg.addExecution(new TrainStationExecution(this.mine));
      this.stationCreated = true;
    }
    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }
    if (this.mine.isUnderConstruction() || this.mine.isDisabled()) return;

    const tile = this.mine.tile();
    const seam = this.mg.config().resourceAtTile(this.mg, tile);
    if (seam === null) return;

    const perTick =
      this.mg.config().mineProductionPerLevel(seam.type, seam.grade) *
      this.mine.level();
    const dug = this.mg.extractResourceAt(tile, perTick);
    if (dug > 0) {
      this.mine.addFreight(seam.type, dug);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/**
 * Everything a factory can pick up from the mines it is linked to by rail,
 * emptied into the train that is about to leave. Returns null when there is
 * nothing to load, which is now the difference between a paying run and a
 * pointless one.
 *
 * Richer freight goes first: a train with room for 600 units takes the diamonds
 * before the coal, so a lucky seam is never left sitting behind a slag heap.
 */
export function loadFreightFromCluster(
  mg: Game,
  factory: Unit,
): { type: ResourceType; amount: number } | null {
  const station = mg.railNetwork().stationManager().findStation(factory);
  const cluster = station?.getCluster();
  if (!cluster) return null;

  const owner = factory.owner();
  const capacity = mg.config().trainFreightCapacity();
  const mines: Unit[] = [];
  for (const s of cluster.stations) {
    const unit = s.unit;
    if (
      unit.type() === UnitType.Mine &&
      unit.owner() === owner &&
      unit.isActive() &&
      !unit.isUnderConstruction()
    ) {
      mines.push(unit);
    }
  }
  if (mines.length === 0) return null;

  for (const type of [
    ResourceType.Diamond,
    ResourceType.Ore,
    ResourceType.Coal,
  ]) {
    let taken = 0;
    for (const mine of mines) {
      if (taken >= capacity) break;
      taken += mine.takeFreight(type, capacity - taken);
    }
    if (taken > 0) return { type, amount: taken };
  }
  return null;
}
