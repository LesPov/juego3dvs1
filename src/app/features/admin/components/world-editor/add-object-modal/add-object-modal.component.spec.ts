import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddObjectModalComponent } from './add-object-modal.component';

describe('AddObjectModalComponent', () => {
  let component: AddObjectModalComponent;
  let fixture: ComponentFixture<AddObjectModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddObjectModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddObjectModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
