// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/event-manager.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import { fromEvent, Observable, Subject } from 'rxjs';
import { share, takeUntil } from 'rxjs/operators';
import * as THREE from 'three';

/**
 * @Injectable
 * @description
 * Gestiona y centraliza todos los eventos de entrada del DOM (ratón y teclado) para el motor 3D.
 */
@Injectable({ providedIn: 'root' })
export class EventManagerService implements OnDestroy {

  public keyDown$: Observable<KeyboardEvent>;
  public keyUp$: Observable<KeyboardEvent>;
  public canvasMouseDown$: Observable<MouseEvent>;
  public windowResize$: Observable<Event>;
  public canvasMouseMove$: Observable<MouseEvent>;

  /**
   * Almacena las coordenadas del ratón normalizadas (-1 a +1),
   * listas para ser usadas por el Raycaster en la vista 2D.
   */
  public readonly mousePosition = new THREE.Vector2();
  public readonly keyMap = new Map<string, boolean>();

  private destroy$ = new Subject<void>();
  private canvas: HTMLCanvasElement | null = null;

  constructor() {
    this.keyDown$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(takeUntil(this.destroy$), share());
    this.keyUp$ = fromEvent<KeyboardEvent>(window, 'keyup').pipe(takeUntil(this.destroy$), share());
    this.windowResize$ = fromEvent(window, 'resize').pipe(takeUntil(this.destroy$), share());

    this.canvasMouseDown$ = new Subject<MouseEvent>().asObservable();
    this.canvasMouseMove$ = new Subject<MouseEvent>().asObservable();

    this.subscribeToKeyEvents();
  }

  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    this.canvasMouseDown$ = fromEvent<MouseEvent>(this.canvas, 'mousedown').pipe(takeUntil(this.destroy$), share());
    this.canvasMouseMove$ = fromEvent<MouseEvent>(this.canvas, 'mousemove').pipe(takeUntil(this.destroy$), share());

    this.subscribeToMouseEvents();
  }

  private subscribeToKeyEvents(): void {
    this.keyDown$.subscribe(event => this.keyMap.set(event.key.toLowerCase(), true));
    this.keyUp$.subscribe(event => this.keyMap.set(event.key.toLowerCase(), false));
  }

  private subscribeToMouseEvents(): void {
    this.canvasMouseMove$.subscribe(event => {
      if (!this.canvas) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.mousePosition.x = (x / rect.width) * 2 - 1;
      this.mousePosition.y = -(y / rect.height) * 2 + 1;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.keyMap.clear();
  }
}