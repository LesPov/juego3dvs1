// src/app/features/admin/services/scene-object.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SceneObjectResponse } from './admin.service';

@Injectable({
    providedIn: 'root'
})
export class SceneObjectService {
    private baseUrl = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint;

    constructor(private http: HttpClient) { }

    createSceneObject(
        episodeId: number,
        objectData: Omit<SceneObjectResponse, 'id' | 'asset'>
    ): Observable<SceneObjectResponse> {
        const url = `${this.baseUrl}/api/episodes/${episodeId}/objects`;
        console.log(`[SceneObjectService] Creando objeto en: ${url}`, objectData);
        return this.http.post<SceneObjectResponse>(url, objectData);
    }

    updateSceneObject(
        episodeId: number,
        objectId: number,
        dataToUpdate: Partial<Omit<SceneObjectResponse, 'id' | 'asset'>>
    ): Observable<SceneObjectResponse> {
        const url = `${this.baseUrl}/api/episodes/${episodeId}/objects/${objectId}`;
        console.log(`[SceneObjectService] Actualizando objeto ${objectId} con:`, dataToUpdate);
        return this.http.put<SceneObjectResponse>(url, dataToUpdate);
    }
}