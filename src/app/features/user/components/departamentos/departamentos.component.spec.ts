import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CiudadesComponent } from './departamentos.component';

describe('CiudadesComponent', () => {
  let component: CiudadesComponent;
  let fixture: ComponentFixture<CiudadesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CiudadesComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CiudadesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
