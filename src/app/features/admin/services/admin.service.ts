// src/app/core/services/admin/admin.service.ts

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface AssetResponse {
    id: number;
    name: string;
    type: 'model_glb' | 'video_mp4' | 'texture_png' | 'texture_jpg' | 'sound_mp3';
    path: string;
}

export type SceneObjectStatus = 'active' | 'inactive' | 'destroyed';

/**
 * Interfaz principal para los objetos de escena. Contiene todos los campos nuevos.
 */
export interface SceneObjectResponse {
    id: number;
    episodeId: number;
    type: 'cube' | 'sphere' | 'floor' | 'model' | 'video' | 'sound' |
          'camera' | 'torus' | 'ambientLight' | 'directionalLight' | 'cone' |
          'star' | 'galaxy' | 'supernova' | 'diffraction_star';
    name: string;
    isVisible: boolean;
    status: SceneObjectStatus;
    emissiveColor: string;
    emissiveIntensity: number;
    snr?: number | null;
    fwhmPx?: number | null;
    isDominant?: boolean;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    properties: { [key: string]: any } | null;
    assetId?: number | null;
    asset?: AssetResponse | null;
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
    createdAt: string;
    updatedAt: string;
}

export interface PaginatedEpisodeResponse {
    episode: EpisodeResponse;
    sceneObjects: SceneObjectResponse[];
    pagination: {
        totalObjects: number;
        totalPages: number;
        currentPage: number;
        limit: number;
    };
}

export interface CreateEpisodeResponse {
    message: string;
    episode: EpisodeResponse;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;
  private episodesUrl: string = `${this.baseUrl}/api/episodes`;

  constructor(private http: HttpClient) {}

  createEpisode(episodeData: FormData): Observable<CreateEpisodeResponse> {
    return this.http.post<CreateEpisodeResponse>(this.episodesUrl, episodeData);
  }

  getEpisodes(): Observable<EpisodeResponse[]> {
    return this.http.get<EpisodeResponse[]>(this.episodesUrl);
  }

  getEpisodeForEditor(id: number): Observable<PaginatedEpisodeResponse> {
    return this.http.get<PaginatedEpisodeResponse>(`${this.episodesUrl}/${id}`);
  }
}