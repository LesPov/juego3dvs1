import {
  Component,
  OnDestroy,
  AfterViewInit,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { ToastrService } from 'ngx-toastr';
import { HttpClient, HttpParams } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import { ProfileService } from '../../../profile/services/profileServices';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-ubicacion-registro',
  templateUrl: './ubicacion-registro.component.html',
  styleUrls: ['./ubicacion-registro.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UbicacionRegistroComponent implements AfterViewInit, OnDestroy {
  private map!: L.Map;
  private marker: L.Marker | null = null;
    deviceLocation: { lat: number; lng: number } | null = null;
  selectedLocation: { lat: number; lng: number } | null = null;
  direccionSeleccionada = '';
  isLoading = true;
  isRegistered = false;

  private defaultCoords = { lat: 4.6097, lng: -74.0817 };

  constructor(
    private router: Router,
    private toastr: ToastrService,
    private profileService: ProfileService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {
    L.Icon.Default.imagePath = 'assets/leaflet/images/';
  }

  ngAfterViewInit(): void {
    this.initializeMap(this.defaultCoords.lat, this.defaultCoords.lng);
    this.initializeComponent();
  }

  private async initializeComponent(): Promise<void> {
    // 1) Verificar registro
    try {
      const profile = await lastValueFrom(this.profileService.getProfile());
      if (profile?.campiamigo) {
        this.isRegistered = true;
        this.toastr.info('Ya estás registrado, redirigiendo…', '', { timeOut: 2000 });
        this.router.navigate(['/user/dashboard']);
        return;
      }
    } catch { /* no bloquea */ }

    // 2) Solicitar ubicación al navegador via Leaflet
    this.map.locate({
      setView: true,
      maxZoom: 15,
      watch: false,
      enableHighAccuracy: true,
      timeout: 5000
    });

    // 3) Al encontrar ubicación automáticamente
    this.map.once('locationfound', async (e: L.LocationEvent) => {
      this.deviceLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
      this.updateMarker(e.latlng.lat, e.latlng.lng);

      try {
        await this.fetchAndFormatAddress(e.latlng.lat, e.latlng.lng);
        this.toastr.success('Ubicación detectada correctamente', '', { timeOut: 2000 });
      } catch {
        // El propio fetch lanza el error y muestra toast
      }

      this.isLoading = false;
      this.cdr.markForCheck();
    });

    // 4) Si falla la geolocalización
    this.map.once('locationerror', () => {
      this.toastr.warning('No fue posible detectar tu ubicación, usa el mapa');
      this.deviceLocation = this.defaultCoords;
      this.updateMarker(this.defaultCoords.lat, this.defaultCoords.lng);
      this.fetchAndFormatAddress(this.defaultCoords.lat, this.defaultCoords.lng)
        .then(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        });
    });
  }

  private initializeMap(lat: number, lng: number): void {
    this.map = L.map('map', { scrollWheelZoom: true }).setView([lat, lng], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Selección manual
    this.map.on('click', async e => {
      this.map.panTo(e.latlng);
      this.updateMarker(e.latlng.lat, e.latlng.lng);

      try {
        await this.fetchAndFormatAddress(e.latlng.lat, e.latlng.lng);
        this.toastr.success('Ubicación seleccionada correctamente', '', { timeOut: 2000 });
      } catch {
        // Error toast ya se muestra dentro de fetchAndFormatAddress
      }
    });

    setTimeout(() => this.map.invalidateSize(), 0);
  }

  private updateMarker(lat: number, lng: number): void {
    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = L.marker([lat, lng]).addTo(this.map);
    }
    this.selectedLocation = { lat, lng };
  }

  /** Llama al backend; lanza en success, muestra toast en error */
  private async fetchAndFormatAddress(lat: number, lng: number): Promise<void> {
    const url = `${environment.endpoint}api/geocode/reverse`;
    const params = new HttpParams().set('lat', lat.toString()).set('lon', lng.toString());
    try {
      const data: any = await lastValueFrom(this.http.get<any>(url, { params }));
      const clean = this.formatAddress(data.address);
      this.direccionSeleccionada = `${clean} (Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)})`;
    } catch {
      this.direccionSeleccionada = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
      this.toastr.error('Error al obtener la dirección', '', { timeOut: 2000 });
      throw new Error('Reverse-geocode failed');
    }
  }

  private formatAddress(addr: any): string {
    const parts = [
      addr.road,
      addr.neighbourhood,
      addr.suburb,
      addr.city || addr.town || addr.village,
      addr.state_district,
      addr.postcode,
      addr.country
    ];
    const filtered: string[] = [];
    for (const p of parts) {
      if (p && p !== filtered[filtered.length - 1]) {
        filtered.push(p);
      }
    }
    return filtered.join(', ');
  }

  /** Centra en la ubicación del dispositivo */
  public centrarEnMiUbicacion(): void {
    const loc = this.deviceLocation;
    if (!loc) return;
    this.map.setView([loc.lat, loc.lng], 15);
    this.updateMarker(loc.lat, loc.lng);
    this.fetchAndFormatAddress(loc.lat, loc.lng)
      .then(() => this.toastr.success('Volviste a tu ubicación', '', { timeOut: 2000 }))
      .catch(() => {/* ya notifica error */});
  }

  public handleContinue(): void {
    if (this.isRegistered) {
      this.toastr.warning('Ya estás registrado.');
      return;
    }
    if (!this.selectedLocation) {
      this.toastr.error('Selecciona primero una ubicación.');
      return;
    }
    localStorage.setItem('userLocation', JSON.stringify({
      direccion: this.direccionSeleccionada,
      coords: this.selectedLocation
    }));
    this.router.navigate(['/user/registerCampiamigo']);
  }

  ngOnDestroy(): void {
    this.map.off();
    this.map.remove();
  }
}
