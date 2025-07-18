import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResetPasswordRecoveryComponent } from './reset-password-recovery.component';

describe('ResetPasswordRecoveryComponent', () => {
  let component: ResetPasswordRecoveryComponent;
  let fixture: ComponentFixture<ResetPasswordRecoveryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResetPasswordRecoveryComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ResetPasswordRecoveryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
