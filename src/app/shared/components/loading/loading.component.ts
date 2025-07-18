import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-loading',
  imports: [CommonModule],
  templateUrl: './loading.component.html',
  styleUrl: './loading.component.css'
}) 
export class LoadingComponent implements OnInit, OnDestroy {
  showModal: boolean = true; // Modal visible al inicio
  private timeoutId: number | null = null;

  constructor(private router: Router) {}

  ngOnInit() {
    // Se cierra el modal automáticamente después de 3.5 segundos y se redirige al home
    this.timeoutId = window.setTimeout(() => this.closeModal(), 3500);
  }

  ngOnDestroy() {
    // Limpiar el timeout si el componente se destruye antes
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }
  }

  closeModal() {
    this.showModal = false; // Cierra el modal
    localStorage.setItem('modalShown', 'true'); // Marca que ya se mostró el modal
    this.router.navigate(['/inicio']); // Redirige al home
  }
} 