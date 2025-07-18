import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
 import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-header-user',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './header-user.component.html',
  styleUrls: ['./header-user.component.css']
})
export class HeaderUserComponent implements OnInit, OnDestroy {
  dropdownVisible = false;
  isSceneRoute = false; // Propiedad para controlar la clase 'transparent'
  private routerSub!: Subscription;

  constructor(
    private router: Router,
    private elementRef: ElementRef,
     private cdr: ChangeDetectorRef, // Inyecta ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        const url = e.urlAfterRedirects;
        // Comprueba si la ruta empieza por /user/estaciones/scene
        // Esto cubrirá rutas como /user/estaciones/scene/123 o /user/estaciones/scene
        this.isSceneRoute = /^\/user\/estaciones\/scene(\/|$)/.test(url);
        // Forzar detección de cambios para que Angular actualice la clase en el HTML
        this.cdr.detectChanges();
      });
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe(); // Limpiar la suscripción para evitar fugas de memoria
  }

  toggleDropdown(): void {
    this.dropdownVisible = !this.dropdownVisible;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Cierra el menú desplegable si se hace clic fuera de él
    if (this.dropdownVisible && !this.elementRef.nativeElement.contains(event.target)) {
      this.dropdownVisible = false;
    }
  }

 
}