// src/app/admin/pages/world-editor/tour-guide/tour-guide.component.ts
import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
import { Subscription } from 'rxjs';
import { TourService, TourStep } from '../../../services/tour.service';

@Component({
  selector: 'app-tour-guide',
  standalone: true,
  imports: [CommonModule, NgStyle],
  templateUrl: './tour-guide.component.html',
  styleUrls: ['./tour-guide.component.css']
})
export class TourGuideComponent implements OnInit, OnDestroy {
  public isTourActive = false;
  public currentStep: TourStep | null = null;
  public modalStyle: { [key: string]: string } = {};
  public highlightStyle: { [key: string]: string } = {};
  public overlayStyle: { [key: string]: string } = {}; // ✨ NUEVA PROPIEDAD

  public totalSteps = 0;
  public currentIndex = 0;

  private tourSubscription?: Subscription;
  private resizeObserver: ResizeObserver;

  constructor(public tourService: TourService, private cdr: ChangeDetectorRef) {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.isTourActive && this.currentStep) {
        this.calculatePosition(this.currentStep);
      }
    });
  }

  ngOnInit(): void {
    this.tourSubscription = this.tourService.isTourActive$.subscribe(isActive => {
      this.isTourActive = isActive;
      if (!isActive) {
        this.resizeObserver.disconnect();
      }
      this.cdr.detectChanges();
    });

    this.tourSubscription.add(
      this.tourService.currentStep$.subscribe(step => {
        this.currentStep = step;
        this.totalSteps = this.tourService.getTotalSteps();
        this.currentIndex = this.tourService.getCurrentIndex();

        this.resizeObserver.disconnect();
        if (step) {
          // Usamos un pequeño delay para asegurar que el DOM se ha actualizado
          setTimeout(() => this.calculatePosition(step), 0);
          const targetElement = document.getElementById(step.targetId);
          if (targetElement) {
            this.resizeObserver.observe(targetElement);
            this.resizeObserver.observe(document.body);
          }
        }
        this.cdr.detectChanges();
      })
    );
  }

  ngOnDestroy(): void {
    this.tourSubscription?.unsubscribe();
    this.resizeObserver.disconnect();
  }

  // =========================================================
  // ===       ✨ LÓGICA DE POSICIONAMIENTO ACTUALIZADA ✨      ===
  // =========================================================
  private calculatePosition(step: TourStep): void {
    const targetElement = document.getElementById(step.targetId);
    if (!targetElement) {
      this.modalStyle = { 'display': 'none' };
      this.highlightStyle = { 'display': 'none' };
      this.overlayStyle = { 'clip-path': 'none' };
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    const modalElement = document.querySelector('.tour-modal-content') as HTMLElement;
    const modalWidth = modalElement?.offsetWidth || 350;
    const modalHeight = modalElement?.offsetHeight || 150;
    const margin = 15;

    let top = 0, left = 0;

    switch (step.position) {
      case 'bottom':
        top = targetRect.bottom + margin;
        left = targetRect.left + (targetRect.width / 2) - (modalWidth / 2);
        break;
      case 'top':
        top = targetRect.top - modalHeight - margin;
        left = targetRect.left + (targetRect.width / 2) - (modalWidth / 2);
        break;
      case 'right':
        top = targetRect.top + (targetRect.height / 2) - (modalHeight / 2);
        left = targetRect.right + margin;
        break;
      case 'left':
        top = targetRect.top + (targetRect.height / 2) - (modalHeight / 2);
        left = targetRect.left - modalWidth - margin;
        break;
      case 'center':
        top = window.innerHeight / 2 - modalHeight / 2;
        left = window.innerWidth / 2 - modalWidth / 2;
        break;
    }

    if (left < margin) left = margin;
    if (top < margin) top = margin;
    if (left + modalWidth > window.innerWidth) left = window.innerWidth - modalWidth - margin;
    if (top + modalHeight > window.innerHeight) top = window.innerHeight - modalHeight - margin;

    this.modalStyle = { 'top': `${top}px`, 'left': `${left}px` };

    // Estilo del borde amarillo (sin cambios)
    this.highlightStyle = {
      'top': `${targetRect.top - 5}px`,
      'left': `${targetRect.left - 5}px`,
      'width': `${targetRect.width + 10}px`,
      'height': `${targetRect.height + 10}px`,
      'display': step.position !== 'center' ? 'block' : 'none'
    };

    // ✨ NUEVO: Calcular el 'clip-path' para el overlay
    if (step.position !== 'center') {
      const padding = 5; // Mismo padding que el borde amarillo
      const x1 = targetRect.left - padding;
      const y1 = targetRect.top - padding;
      const x2 = targetRect.right + padding;
      const y2 = targetRect.bottom + padding;
      
      // Creamos una ruta poligonal que rodea la pantalla y luego "corta" un agujero
      const polygonPath = `0 0, 0 100%, 100% 100%, 100% 0, 0 0, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px`;

      this.overlayStyle = {
        'clip-path': `polygon(${polygonPath})`
      };
    } else {
      // Para la posición 'center', el overlay es sólido (sin agujero)
      this.overlayStyle = { 'clip-path': 'none' };
    }
  }
}