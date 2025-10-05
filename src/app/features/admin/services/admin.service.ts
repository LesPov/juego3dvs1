// src/app/core/services/admin/admin.service.ts

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type AnalysisType =
  | 'DEEP_SPACE_ASTROPHOTOGRAPHY'
  | 'PLANETARY_BODY'
  | 'NEBULA';

// --- ✨ NUEVA INTERFAZ PARA METADATOS WMTS ✨ ---
// Refleja exactamente la estructura de metadatos del backend.
export interface WmtsMetadata {
  layerId: string;
  title: string;
  abstract: string;
  bbox: string;
  projection: string;
  tileMatrixSet: string;
}

/**
 * --- ✨ INTERFAZ DE ASSET COMPLETAMENTE ACTUALIZADA ✨ ---
 * Representa cualquier tipo de Asset devuelto por la API, incluyendo los WMTS.
 */
export interface AssetResponse {
  id: number;
  name: string;
  // 🔧 MODIFICADO: Se añade 'texture_wmts' al tipo.
  type: 'model_glb' | 'video_mp4' | 'texture_png' | 'texture_jpg' | 'sound_mp3' | 'texture_wmts';
  path: string; // Para WMTS, esta será la plantilla de URL procesada.
  // ✨ NUEVO: Especifica el origen del asset.
  sourceType: 'LOCAL' | 'REMOTE_WMTS';
  // ✨ NUEVO: Contiene los metadatos enriquecidos para los assets WMTS.
  metadata?: WmtsMetadata | null;
}

export type SceneObjectStatus = 'active' | 'inactive' | 'destroyed';

export type SceneObjectType = 
  | 'model' | 'cube' | 'sphere' | 'floor' | 'video' | 'sound' | 'camera' 
  | 'ambientLight' | 'directionalLight' | 'pointLight' | 'cone' | 'torus'
  | 'galaxy_normal' | 'galaxy_bright' | 'galaxy_medium'| 'galaxy_far';

export interface GalaxyDataResponse {
  id: number;
  sceneObjectId: number;
  isVisible: boolean;
  emissiveColor: string;
  emissiveIntensity: number;
  isDominant: boolean;
  snr: number;
  fwhmPx: number;
}

export interface SceneObjectResponse {
  id: number;
  episodeId: number;
  type: SceneObjectType;
  name: string;
  status: SceneObjectStatus;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  properties: { [key: string]: any } | null;
  assetId?: number | null;
  // 🔧 MODIFICADO: Usa la nueva interfaz AssetResponse.
  asset?: AssetResponse | null;
  galaxyData?: GalaxyDataResponse | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EpisodeResponse {
  id: number;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  isPublished: boolean;
  authorId: number;
  analysisState: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  analysisType: AnalysisType;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedEpisodeResponse {
    episode: EpisodeResponse;
    sceneObjects: SceneObjectResponse[];
    pagination: any;
}

export interface CreateEpisodeResponse {
    message: string;
    episode: EpisodeResponse;
}

export interface CreateEpisodePayload {
    title: string;
    description?: string;
    analysisType: AnalysisType;
    thumbnail: File;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;
  private episodesUrl: string = `${this.baseUrl}/api/episodes`;

  constructor(private http: HttpClient) { }

  createEpisode(episodeData: FormData): Observable<CreateEpisodeResponse> {
    return this.http.post<CreateEpisodeResponse>(`${this.episodesUrl}/`, episodeData);
  }

  getEpisodes(): Observable<EpisodeResponse[]> {
    return this.http.get<EpisodeResponse[]>(this.episodesUrl);
  }

  getEpisodeForEditor(id: number): Observable<PaginatedEpisodeResponse> {
    return this.http.get<PaginatedEpisodeResponse>(`${this.episodesUrl}/${id}`);
  }
}