// src/app/features/admin/services/asset.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AssetResponse } from './admin.service';
// 🔧 MODIFICADO: Importamos la interfaz actualizada desde el servicio principal.
 
/**
 * --- ✨ NUEVA INTERFAZ PARA EL PAYLOAD DE CREACIÓN ✨ ---
 * Define los datos necesarios para crear un nuevo asset WMTS.
 */
export interface CreateWmtsAssetPayload {
  name: string;
  wmtsEndpoint: string;
  layerId: string;
  bbox: string;
}

@Injectable({
  providedIn: 'root'
})
export class AssetService {
  private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;
  private assetsUrl = `${this.baseUrl}/api/assets`;

  constructor(private http: HttpClient) { }

  /**
   * Obtiene todos los assets disponibles desde el backend.
   * @returns Un observable con la lista de assets (incluyendo los WMTS).
   */
  getAssets(): Observable<AssetResponse[]> {
    return this.http.get<AssetResponse[]>(this.assetsUrl);
  }

  /**
   * --- ✨ NUEVO MÉTODO PARA CREAR ASSETS WMTS ✨ ---
   * Envía la solicitud para crear un nuevo asset de tipo WMTS.
   * @param payload Los datos del servicio WMTS a registrar.
   * @returns Un observable con el nuevo asset creado por el backend.
   */
  createWmtsAsset(payload: CreateWmtsAssetPayload): Observable<AssetResponse> {
    const url = `${this.assetsUrl}/wmts`;
    return this.http.post<AssetResponse>(url, payload);
  }

  // Aquí podrías añadir en el futuro otros métodos como:
  // uploadAsset(file: File): Observable<AssetResponse>
  // deleteAsset(assetId: number): Observable<void>
}