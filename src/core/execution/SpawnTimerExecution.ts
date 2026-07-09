import { Execution, Game, PlayerType } from "../game/Game";
import { Executor } from "./ExecutionManager";

// Auto-spawn unspawned humans this many ticks before the spawn phase ends, so
// their territory (and the in-game HUD/camera) is in place by the time the phase
// closes. Spawning exactly at the deadline left a gap where the player owned no
// tiles and the UI didn't come up.
const AUTO_SPAWN_LEAD = 10;

export class SpawnTimerExecution implements Execution {
  private mg: Game;
  private autoSpawned = false;

  constructor(private executor: Executor) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    const spawnTurns = this.mg.config().numSpawnPhaseTurns();

    // Shortly before the phase ends, give any human who never picked a spawn a
    // random one so they don't start with no territory ("left outside"). Doing
    // it a little early (still during the phase) means they own tiles — and get
    // the normal in-game UI — before the phase closes. A tile-less SpawnExecution
    // no-ops if the player has since spawned (it guards double-spawns).
    if (!this.autoSpawned && this.mg.ticks() >= spawnTurns - AUTO_SPAWN_LEAD) {
      this.autoSpawned = true;
      for (const player of this.mg.allPlayers()) {
        if (player.type() === PlayerType.Human && !player.hasSpawned()) {
          this.mg.addExecution(
            this.executor.spawnPlayerExecution(player.info()),
          );
        }
      }
    }

    if (this.mg.ticks() > spawnTurns) {
      this.mg.endSpawnPhase();
    }
  }

  isActive(): boolean {
    return this.mg.inSpawnPhase();
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
