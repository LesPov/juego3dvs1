import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RegistroCampiamigoComponent } from './registro-campiamigo.component';

describe('RegistroCampiamigoComponent', () => {
  let component: RegistroCampiamigoComponent;
  let fixture: ComponentFixture<RegistroCampiamigoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegistroCampiamigoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RegistroCampiamigoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
