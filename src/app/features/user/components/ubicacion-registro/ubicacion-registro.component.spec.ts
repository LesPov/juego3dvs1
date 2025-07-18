import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UbicacionRegistroComponent } from './ubicacion-registro.component';

describe('UbicacionRegistroComponent', () => {
  let component: UbicacionRegistroComponent;
  let fixture: ComponentFixture<UbicacionRegistroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UbicacionRegistroComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UbicacionRegistroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
