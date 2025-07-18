import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EpisodiosComponent } from './episodios.component';

describe('EpisodiosComponent', () => {
  let component: EpisodiosComponent;
  let fixture: ComponentFixture<EpisodiosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EpisodiosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EpisodiosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
