import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorldViewComponent } from './world-view.component';

describe('WorldViewComponent', () => {
  let component: WorldViewComponent;
  let fixture: ComponentFixture<WorldViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldViewComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WorldViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
