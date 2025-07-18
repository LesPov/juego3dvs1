// departamentos.component.ts

import { CommonModule, Location } from '@angular/common';
import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Swiper } from 'swiper';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';
import { CampiAmigoZonesService } from '../../../campiamigo/services/campiAmigoZones.service';
import { environment } from '../../../../../environments/environment';

// Interfaz para mayor claridad en el tipo de dato
interface Departamento {
  departamentoName: string;
  cityImage: string;
  characterImage: string;
  climate: string;
}

@Component({
  selector: 'app-departamentos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './departamentos.component.html',
  styleUrls: ['./departamentos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush // Estrategia recomendada para Swiper
})
export class CiudadesComponent implements OnInit, AfterViewInit, OnDestroy {
  // --- PROPIEDADES DE SWIPER (LÓGICA COPIADA DE ESTACIONES) ---
  @ViewChild('departamentosSwiperContainer') departamentosSwiperContainer!: ElementRef<HTMLElement>;
  private swiperInstance: Swiper | null = null;
  public currentSlideIndex = 0;

  // --- PROPIEDADES ORIGINALES DE DEPARTAMENTOS (CONSERVADAS) ---
  ciudadesUnicas: Departamento[] = [];
  proximamenteDepartamentos: string[] = ['boyaca', 'norte de santander'];
  proximamenteDepartamentosNormalized: string[] = [];

  readonly imagenesPorDepartamento: Record<string, string> = {
    'cundinamarca': 'Cundinamarca.jpg',
    'boyaca': 'Boyaca.jpg',
    'norte de santander': 'Boyaca.jpg',
  };

  readonly charactersPorDepartamento: Record<string, string> = {
    'cundinamarca': 'DSC01271-removebg-preview.png',
  };

  filterModalOpen: boolean = false;
  filterQuery: string = '';

  constructor(
    private campiService: CampiAmigoZonesService,
    private route: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private location: Location,
    private cdRef: ChangeDetectorRef // Inyectado para Swiper
  ) { }

  ngOnInit(): void {
    this.proximamenteDepartamentosNormalized = this.proximamenteDepartamentos.map(dep => this.normalizeName(dep));
    this.route.queryParams.subscribe((params) => {
      const clima = params['climate'];
      localStorage.setItem('climate', clima);
      this.cargarCiudades(clima);
    });
  }

  ngAfterViewInit(): void {
    // La inicialización se moverá a `cargarCiudades` para asegurar que los datos existen.
  }

  ngOnDestroy(): void {
    this.destroySwiper();
  }

  // --- MÉTODOS DE SWIPER (LÓGICA COPIADA Y ADAPTADA) ---
  private initializeSwiper(): void {
    // Destruimos cualquier instancia anterior para evitar duplicados al recargar datos
    this.destroySwiper();
    
    const el = this.departamentosSwiperContainer?.nativeElement;

    if (el && this.ciudadesUnicas.length > 0) {
      this.swiperInstance = new Swiper(el, {
        modules: [Navigation, Pagination, Autoplay],
        slidesPerView: 1,
        centeredSlides: true,
        loop: true,
        grabCursor: true,
        autoplay: {
          delay: 7000,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        },
        pagination: false, // Usaremos nuestra paginación custom
        navigation: {
          nextEl: '.departamentos-swiper-button-next',
          prevEl: '.departamentos-swiper-button-prev',
        },
      });

      // Escuchador para actualizar el índice del slide activo para los dots
      this.swiperInstance.on('slideChange', () => {
        if (this.swiperInstance) {
          this.currentSlideIndex = this.swiperInstance.realIndex;
          this.cdRef.markForCheck(); // Notificamos a Angular del cambio
        }
      });
    }
  }

  private destroySwiper(): void {
    if (this.swiperInstance) {
      this.swiperInstance.destroy(true, true);
      this.swiperInstance = null;
    }
  }
  
  public goToSlide(index: number): void {
    if (this.swiperInstance) {
      this.swiperInstance.slideToLoop(index);
    }
  }
  
  // --- MÉTODOS ORIGINALES DE DEPARTAMENTOS (MODIFICADOS/CONSERVADOS) ---
  private async cargarCiudades(climate?: string): Promise<void> {
    this.campiService.getZones(climate).subscribe({
      next: async (response) => {
        const zonas = response.zones;
        const ciudadesMap = new Map<string, Omit<Departamento, 'departamentoName'>>();

        zonas.forEach((zona) => {
          const depto = zona.departamento;
          if (depto && !ciudadesMap.has(depto)) {
            ciudadesMap.set(depto, {
              cityImage: '',
              characterImage: '',
              climate: zona.climate || 'desconocido',
            });
          }
        });

        const ciudadArrayPromises = Array.from(ciudadesMap.entries()).map(
          async ([departamentoName, ciudadData]) => {
            const deptoNormalized = this.normalizeName(departamentoName);
            const nombreImagen = this.imagenesPorDepartamento[deptoNormalized] || '';
            const nombrePersonaje = this.charactersPorDepartamento[deptoNormalized] || '';
            return {
              departamentoName,
              ...ciudadData,
              cityImage: nombreImagen ? `${environment.endpoint}uploads/zones/images/${nombreImagen}` : 'assets/img/default-city.jpg',
              characterImage: nombrePersonaje ? `${environment.endpoint}uploads/mejorCampiamigo/${nombrePersonaje}` : '',
            };
          }
        );

        this.ciudadesUnicas = await Promise.all(ciudadArrayPromises);
        this.currentSlideIndex = 0; // Reseteamos el slide al cargar nuevos datos
        this.cdRef.detectChanges(); // Forzamos la actualización de la vista con los nuevos datos

        // Inicializamos Swiper DESPUÉS de que los datos estén cargados y el DOM actualizado
        requestAnimationFrame(() => {
          this.initializeSwiper();
        });
      },
      error: (err) => console.error('Error cargando departamentos:', err),
    });
  }
  
  normalizeName(name: string): string {
    return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  navigateToZone(ciudad: Departamento): void {
    if (this.proximamenteDepartamentosNormalized.includes(this.normalizeName(ciudad.departamentoName))) return;
    localStorage.setItem('departamento', ciudad.departamentoName);
    localStorage.setItem('climate', ciudad.climate);
    this.router.navigate(['/user/estaciones/zone'], {
      queryParams: { dept: ciudad.departamentoName, climate: ciudad.climate },
    });
  }

  goBack(): void {
    this.location.back();
  }

  openFilterModal(): void {
    this.filterModalOpen = true;
    this.filterQuery = '';
  }

  closeFilterModal(): void {
    this.filterModalOpen = false;
  }

  searchDepartment(): void {
    const queryNormalized = this.normalizeName(this.filterQuery);
    if (!queryNormalized) {
      this.toastr.warning('Por favor ingrese un nombre.');
      return;
    }
    const foundIndex = this.ciudadesUnicas.findIndex(ciudad =>
      this.normalizeName(ciudad.departamentoName) === queryNormalized
    );
    if (foundIndex !== -1) {
      this.goToSlide(foundIndex); // *** ACTUALIZADO: Usamos el método de Swiper ***
    } else {
      this.toastr.warning('Departamento no encontrado.');
    }
    this.closeFilterModal();
  }
}