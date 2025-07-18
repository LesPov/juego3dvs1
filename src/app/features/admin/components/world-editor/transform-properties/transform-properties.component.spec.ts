import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TransformPropertiesComponent } from './transform-properties.component';

describe('TransformPropertiesComponent', () => {
  let component: TransformPropertiesComponent;
  let fixture: ComponentFixture<TransformPropertiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransformPropertiesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TransformPropertiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
