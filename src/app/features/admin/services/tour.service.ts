// src/app/admin/pages/world-editor/services/tour.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type TourStepPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  step: number;
  targetId: string; // El ID del elemento HTML al que se adjunta
  title: string;
  content: string;
  position: TourStepPosition;
  action?: () => void; // Acción a ejecutar ANTES de mostrar el paso (ej. abrir un panel)
}

@Injectable({
  providedIn: 'root'
})
export class TourService {
  private tourSteps: TourStep[] = [];
  
  private readonly isTourActive = new BehaviorSubject<boolean>(false);
  public isTourActive$ = this.isTourActive.asObservable();

  private readonly currentStep = new BehaviorSubject<TourStep | null>(null);
  public currentStep$ = this.currentStep.asObservable();

  private currentIndex = -1;

  public initialize(steps: TourStep[]): void {
    this.tourSteps = steps.sort((a, b) => a.step - b.step);
  }

  public start(): void {
    if (this.tourSteps.length === 0) {
      console.error("El tour no tiene pasos definidos.");
      return;
    }
    this.isTourActive.next(true);
    this.goToStep(0);
  }

  public stop(): void {
    this.isTourActive.next(false);
    this.currentIndex = -1;
    this.currentStep.next(null);
  }

  public next(): void {
    if (this.currentIndex < this.tourSteps.length - 1) {
      this.goToStep(this.currentIndex + 1);
    } else {
      this.stop();
    }
  }

  public prev(): void {
    if (this.currentIndex > 0) {
      this.goToStep(this.currentIndex - 1);
    }
  }

  private goToStep(index: number): void {
    this.currentIndex = index;
    const step = this.tourSteps[this.currentIndex];

    // Ejecuta la acción asociada si existe
    if (step.action) {
      step.action();
    }

    // Un pequeño delay para dar tiempo a la UI a reaccionar a la acción (ej. abrir un panel)
    setTimeout(() => {
      this.currentStep.next(step);
    }, 100); // 100ms es usualmente suficiente para que las animaciones de paneles comiencen
  }

  public getTotalSteps(): number {
    return this.tourSteps.length;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }
}