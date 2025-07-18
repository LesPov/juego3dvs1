// estaciones.component.ts
// NO SE REQUIEREN CAMBIOS EN ESTE ARCHIVO

import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Swiper } from 'swiper';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';

interface Estacion {
  tipo: string;
  claseCss: string;
  coverImage: string;
  titleImage: string;
  characterImage: string;
  altCover: string;
  altTitle: string;
  altCharacter: string;
}

@Component({
  selector: 'app-estaciones',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './estaciones.component.html',
  styleUrls: ['./estaciones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EstacionesComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('estacionesSwiperContainer') estacionesSwiperContainer!: ElementRef<HTMLElement>;
  private estacionesSwiperInstance: Swiper | null = null;
  public currentSlideIndex = 0;

  public readonly estaciones: Estacion[] = [
    {
      tipo: 'clima cálido',
      claseCss: 'one',
      coverImage: 'assets/img/zonas/climacalido.avif',
      titleImage: 'assets/img/zonas/title.png',
      characterImage: 'assets/img/zonas/characterCalido.png',
      altCover: 'Paisaje de una zona agrícola de clima cálido',
      altTitle: 'Título decorativo para la estación de clima cálido',
      altCharacter: 'Personaje animado representativo de la zona cálida'
    },
    {
      tipo: 'clima frío',
      claseCss: 'two',
      coverImage: 'assets/img/zonas/climafrio.avif',
      titleImage: 'assets/img/zonas/titlefrio.png',
      characterImage: 'assets/img/zonas/characterfrio1.png',
      altCover: 'Paisaje de una zona agrícola montañosa de clima frío',
      altTitle: 'Título decorativo para la estación de clima frío',
      altCharacter: 'Personaje animado representativo de la zona fría'
    }
  ];

  constructor(private router: Router, private cdRef: ChangeDetectorRef) { }

  ngOnInit(): void { }

  ngAfterViewInit(): void {
    requestAnimationFrame(() => {
      this.initializeSwiper();
    });
  }
  ngOnDestroy(): void {
    this.destroySwiper();
  }

  public seleccionarZona(zona: string): void {
    const climateValue = zona === 'clima cálido' ? 'calido' : 'frio';
    localStorage.setItem('climate', climateValue);
    this.router.navigate(['/user/estaciones/departamentos'], { queryParams: { climate: climateValue } });
  }

  public goToSlide(index: number): void {
    if (this.estacionesSwiperInstance) {
      this.estacionesSwiperInstance.slideToLoop(index);
    }
  }

  private initializeSwiper(): void {
    const el = this.estacionesSwiperContainer?.nativeElement;

    if (el instanceof HTMLElement && this.estaciones.length > 0) {
      this.estacionesSwiperInstance = new Swiper(el, {
        modules: [Navigation, Pagination, Autoplay],
        slidesPerView: 1,
        centeredSlides: true,
        loop: true,
        grabCursor: true,
        autoplay: {
          delay: 5000,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        },
        pagination: false,
        navigation: {
          nextEl: '.estaciones-swiper-button-next',
          prevEl: '.estaciones-swiper-button-prev',
        },
      });

      this.estacionesSwiperInstance.on('slideChange', () => {
        if (this.estacionesSwiperInstance) {
          this.currentSlideIndex = this.estacionesSwiperInstance.realIndex;
          this.cdRef.markForCheck();
        }
      });

    } else {
      console.error('Swiper container is not a valid HTMLElement or estaciones list is empty.');
    }
  }

  private destroySwiper(): void {
    if (this.estacionesSwiperInstance) {
      this.estacionesSwiperInstance.destroy(true, true);
      this.estacionesSwiperInstance = null;
    }
  }
}