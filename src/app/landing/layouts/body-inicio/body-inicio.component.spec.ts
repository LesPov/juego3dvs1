import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BodyInicioComponent } from './body-inicio.component';

describe('BodyInicioComponent', () => {
  let component: BodyInicioComponent;
  let fixture: ComponentFixture<BodyInicioComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BodyInicioComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BodyInicioComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
