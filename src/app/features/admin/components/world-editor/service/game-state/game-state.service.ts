// src/app/services/game-state/game-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export enum GameMode {
  EDITOR,
  PLAY
}

@Injectable({
  providedIn: 'root'
})
export class GameStateService {
  private mode = new BehaviorSubject<GameMode>(GameMode.EDITOR);

  setMode(newMode: GameMode): void {
    console.log(`Cambiando modo a: ${GameMode[newMode]}`);
    this.mode.next(newMode);
  }

  getMode(): Observable<GameMode> {
    return this.mode.asObservable();
  }

  getCurrentMode(): GameMode {
    return this.mode.getValue();
  }
}