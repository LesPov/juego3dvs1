import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SceneObjectResponse } from './admin.service'; // Reutilizamos la interfaz

@Injectable({
  providedIn: 'root'
})
export class SceneObjectService {
  private baseUrl = environment.endpoint.endsWith('/') 
    ? environment.endpoint.slice(0, -1) 
    : environment.endpoint;
  
  constructor(private http: HttpClient) {}

  /**
   * Construye la URL base para los objetos de una escena específica.
   * Ej: http://localhost:3000/api/episodes/61/objects
   * @param episodeId El ID del episodio al que pertenecen los objetos.
   */
  private getObjectsUrl(episodeId: number): string {
    return `${this.baseUrl}/api/episodes/${episodeId}/objects`;
  }

  /**
   * Crea un nuevo objeto de escena dentro de un episodio.
   * Envía una petición POST a /api/episodes/:episodeId/objects
   * @param episodeId El ID del episodio donde se creará el objeto.
   * @param objectData Los datos del nuevo objeto a crear.
   */
  createSceneObject(episodeId: number, objectData: Partial<SceneObjectResponse>): Observable<SceneObjectResponse> {
    console.log(`[SceneObjectService] Creando nuevo objeto en episodio ${episodeId}`, objectData);
    return this.http.post<SceneObjectResponse>(this.getObjectsUrl(episodeId), objectData);
  }

  // ========================================================================
  // === ¡NUEVO MÉTODO PARA ACTUALIZAR!                                   ===
  // ========================================================================
  /**
   * Actualiza un objeto de escena existente.
   * Envía una petición PUT a /api/episodes/:episodeId/objects/:objectId
   * @param episodeId El ID del episodio al que pertenece el objeto.
   * @param objectId El ID del objeto específico que se va a actualizar.
   * @param dataToUpdate Un objeto con solo los campos que se quieren cambiar.
   */
  updateSceneObject(
    episodeId: number, 
    objectId: number, 
    dataToUpdate: Partial<SceneObjectResponse>
  ): Observable<SceneObjectResponse> {
    
    console.log(`[SceneObjectService] Actualizando objeto ${objectId} con:`, dataToUpdate);

    // La URL ahora incluye el ID del objeto específico.
    // Ej: http://localhost:3000/api/episodes/61/objects/1577
    const updateUrl = `${this.getObjectsUrl(episodeId)}/${objectId}`;

    // Usamos http.put para enviar la petición de actualización.
    return this.http.put<SceneObjectResponse>(updateUrl, dataToUpdate);
  }

  // Aquí podrías añadir más métodos en el futuro, como deleteSceneObject, etc.
}