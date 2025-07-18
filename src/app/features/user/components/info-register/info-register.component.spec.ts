import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InfoRegisterComponent } from './info-register.component';

describe('InfoRegisterComponent', () => {
  let component: InfoRegisterComponent;
  let fixture: ComponentFixture<InfoRegisterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InfoRegisterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InfoRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
