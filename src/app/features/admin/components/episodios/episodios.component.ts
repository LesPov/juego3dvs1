// src/app/features/admin/components/episodios/episodios.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AdminService, EpisodeResponse } from '../../services/admin.service';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';

// Interfaz para la vista, ahora incluye la URL completa.
interface EpisodeInfo {
  id: number;
  title: string;
  description: string;
  thumbnailUrl: string | null; // Guardará la URL completa
}

@Component({
  selector: 'app-episodios',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './episodios.component.html',
  styleUrls: ['./episodios.component.css']
})
export class EpisodiosComponent implements OnInit {
  episodes: EpisodeInfo[] = [];
  activeIndex = 0;

  // Estados para una mejor UX
  isLoading = true;
  errorMessage: string | null = null;

  // Lógica del modal
  isModalOpen = false;
  createEpisodeForm: FormGroup;
  selectedFile: File | null = null;
  imagePreview: string | ArrayBuffer | null = null;

  constructor(
    private router: Router,
    private fb: FormBuilder,
    private adminService: AdminService
  ) {
    this.createEpisodeForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      thumbnailFile: [null]
    });
  }

  ngOnInit(): void {
    // Cuando el componente se carga, pedimos la lista de episodios.
    this.loadEpisodes();
  }

  loadEpisodes(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.adminService.getEpisodes()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data: EpisodeResponse[]) => {
          this.episodes = data.map(ep => {
            // ¡LÓGICA CORREGIDA A PRUEBA DE DOBLE SLASH!
            const cleanEndpoint = environment.endpoint.endsWith('/')
              ? environment.endpoint.slice(0, -1)
              : environment.endpoint;

            const cleanThumbnailPath = ep.thumbnailUrl?.startsWith('/')
              ? ep.thumbnailUrl.slice(1)
              : ep.thumbnailUrl;

            const fullThumbnailUrl = ep.thumbnailUrl
              ? `${cleanEndpoint}/${cleanThumbnailPath}`
              : null;

            return {
              id: ep.id,
              title: ep.title,
              description: ep.description,
              thumbnailUrl: fullThumbnailUrl
            };
          });
          if (this.episodes.length > 0) {
            this.activeIndex = 0;
          }
        },
        error: (err: HttpErrorResponse) => {
          this.errorMessage = 'Error al cargar los episodios. Por favor, intenta de nuevo.';
          console.error('Error al cargar episodios:', err);
        }
      });
  }


  selectEpisode(idx: number): void { this.activeIndex = idx; }
  back(): void { this.router.navigate(['/admin/dashboard']); }

  openCreateModal(): void { this.isModalOpen = true; }
  closeModal(): void {
    this.isModalOpen = false;
    this.createEpisodeForm.reset();
    this.imagePreview = null;
    this.selectedFile = null;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      const reader = new FileReader();
      reader.onload = () => this.imagePreview = reader.result;
      reader.readAsDataURL(this.selectedFile);
    }
  }

  onSubmit(): void {
    if (this.createEpisodeForm.invalid) return;

    const formData = new FormData();
    formData.append('title', this.createEpisodeForm.get('title')?.value);
    formData.append('description', this.createEpisodeForm.get('description')?.value);
    if (this.selectedFile) {
      formData.append('thumbnailFile', this.selectedFile, this.selectedFile.name);
    }

    this.adminService.createEpisode(formData).subscribe({
      next: (newEpisode: EpisodeResponse) => {
        console.log('Episodio creado exitosamente:', newEpisode);
        this.closeModal();
        // La mejor práctica: volver a cargar la lista desde el servidor
        // para asegurar que el orden y los datos son correctos.
        this.loadEpisodes();
      },
      error: (err: HttpErrorResponse) => {
        console.error('Error al crear el episodio:', err);
        alert(`Error: ${err.error?.message || err.statusText}`);
      }
    });
  }

  editEpisode(): void {
    if (this.episodes.length > 0) {
      const selectedId = this.episodes[this.activeIndex].id;
      // Asumiendo que la ruta del editor está en el módulo de admin
      this.router.navigate(['/admin/editor', selectedId]);
    }
  }

  deleteEpisode(): void { /* ... Lógica para llamar a la API de borrado ... */ }
}