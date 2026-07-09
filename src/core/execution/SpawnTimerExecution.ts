import { Execution, Game, PlayerType } from "../game/Game";
import { Executor } from "./ExecutionManager";

export class SpawnTimerExecution implements Execution {
  private mg: Game;

  constructor(private executor: Executor) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    if (this.mg.ticks() > this.mg.config().numSpawnPhaseTurns()) {
      // Auto-spawn any human who never picked a spawn tile, so they don't start
      // the game with no territory ("left outside"). A tile-less SpawnExecution
      // spawns at a random valid location; it runs even after the phase ends
      // (activeDuringSpawnPhase), so a player who didn't choose still gets in.
      for (const player of this.mg.allPlayers()) {
        if (player.type() === PlayerType.Human && !player.hasSpawned()) {
          this.mg.addExecution(
            this.executor.spawnPlayerExecution(player.info()),
          );
        }
      }
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
