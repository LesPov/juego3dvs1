// src/app/features/admin/services/admin.service.ts
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
export interface SceneObjectResponse {
    id: number;
   type: 'cube' | 'sphere' | 'floor' | 'model' |
          'camera' | 'ambientLight' | 'directionalLight' | 'cone' | 'torus' |
          'star' | 'galaxy' ;

    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    
    // ============ ¡AJUSTE CRÍTICO! ============
    // Cambiamos el tipo para que sea igual de flexible que en el backend.
    // Esto te permitirá enviar cualquier tipo de propiedad (fov, near, far, intensity, etc.)
    // sin que TypeScript se queje.
    properties: { [key: string]: any }; 
    // ==========================================

    assetId?: number | null;
    asset?: AssetResponse | null;
}

export interface EpisodeResponse {
    analysisSummary: null;
    id: number;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    authorId: number;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
    sceneObjects?: SceneObjectResponse[];
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;
  private episodesUrl: string = `${this.baseUrl}/api/episodes`;
  
  constructor(private http: HttpClient) {}

  createEpisode(episodeData: FormData): Observable<EpisodeResponse> {
    return this.http.post<EpisodeResponse>(this.episodesUrl, episodeData);
  }
  
  getEpisodes(): Observable<EpisodeResponse[]> {
    return this.http.get<EpisodeResponse[]>(this.episodesUrl);
  }
  
  getEpisodeForEditor(id: number): Observable<EpisodeResponse> {
    return this.http.get<EpisodeResponse>(`${this.episodesUrl}/${id}`);
  }
}