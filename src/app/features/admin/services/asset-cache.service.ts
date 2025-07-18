// src/app/features/admin/services/asset.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AssetResponse } from './admin.service';

@Injectable({
  providedIn: 'root'
})
export class AssetService {
  private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;
  private assetsUrl = `${this.baseUrl}/api/assets`;

  constructor(private http: HttpClient) { }

  /**
   * Obtiene todos los assets disponibles desde el backend.
   * @returns Un observable con la lista de assets.
   */
  getAssets(): Observable<AssetResponse[]> {
    return this.http.get<AssetResponse[]>(this.assetsUrl);
  }

  // Aquí podrías añadir en el futuro otros métodos como:
  // uploadAsset(file: File): Observable<AssetResponse>
  // deleteAsset(assetId: number): Observable<void>
}