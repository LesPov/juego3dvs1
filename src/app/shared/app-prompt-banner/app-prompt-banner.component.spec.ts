import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppPromptBannerComponent } from './app-prompt-banner.component';

describe('AppPromptBannerComponent', () => {
  let component: AppPromptBannerComponent;
  let fixture: ComponentFixture<AppPromptBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppPromptBannerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AppPromptBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
