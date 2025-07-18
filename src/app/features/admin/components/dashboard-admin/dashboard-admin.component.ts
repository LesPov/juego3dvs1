// dashboard-admin.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
 
@Component({
  selector: 'app-dashboard-admin',
  standalone: true,
  imports: [FormsModule, RouterModule, CommonModule],
  templateUrl: './dashboard-admin.component.html',
  styleUrls: ['./dashboard-admin.component.css'] // Asegúrate que el nombre del archivo CSS es correcto
})
export class DashboardAdminComponent   {
 constructor(private router: Router) { }

  onJugar(): void {
    this.router.navigateByUrl('/inicio/jugar');
  }
  onAjustes(): void {
    this.router.navigate(['/ajustes']);
  }
  onEpisodios(): void {
    this.router.navigate(['/admin/episodios']);
  }
}