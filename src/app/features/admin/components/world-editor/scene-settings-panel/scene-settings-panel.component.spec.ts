import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SceneSettingsPanelComponent } from './scene-settings-panel.component';

describe('SceneSettingsPanelComponent', () => {
  let component: SceneSettingsPanelComponent;
  let fixture: ComponentFixture<SceneSettingsPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SceneSettingsPanelComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SceneSettingsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
