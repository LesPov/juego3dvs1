import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-scene-settings-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scene-settings-panel.component.html',
  styleUrls: ['./scene-settings-panel.component.css']
})
export class SceneSettingsPanelComponent {
  // Estado para saber qué pestaña de ajustes de escena está activa.
  activeTab: 'render' | 'environment' = 'render';

  setActiveTab(tab: 'render' | 'environment'): void {
    this.activeTab = tab;
  }
}