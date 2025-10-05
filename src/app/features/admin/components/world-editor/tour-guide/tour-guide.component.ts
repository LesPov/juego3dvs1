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
  public overlayStyle: { [key: string]: string } = {};

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
          setTimeout(() => this.calculatePosition(step), 50);
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

    // =========================================================
    // ===       ✅ LÓGICA MODIFICADA PARA EL OVERLAY       ===
    // =========================================================
    // Ahora, SIEMPRE que haya un targetElement, creamos el "agujero" y el borde.
    if (targetElement) {
      const padding = 5;
      const x1 = targetRect.left - padding;
      const y1 = targetRect.top - padding;
      const x2 = targetRect.right + padding;
      const y2 = targetRect.bottom + padding;

      const polygonPath = `
        0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
        ${x1}px ${y1}px,
        ${x2}px ${y1}px,
        ${x2}px ${y2}px,
        ${x1}px ${y2}px,
        ${x1}px ${y1}px
      `;

      this.overlayStyle = {
        'clip-path': `polygon(evenodd, ${polygonPath})`
      };

      this.highlightStyle = {
        'top': `${targetRect.top}px`,
        'left': `${targetRect.left}px`,
        'width': `${targetRect.width}px`,
        'height': `${targetRect.height}px`,
        'display': 'block'
      };

    } else {
      // Si por alguna razón no hay target, el overlay es sólido.
      this.overlayStyle = { 'clip-path': 'none' };
      this.highlightStyle = { 'display': 'none' };
    }
  }
}