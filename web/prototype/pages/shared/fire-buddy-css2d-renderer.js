import { Matrix4, Object3D, Vector2, Vector3 } from 'three';

export class FireBuddyCSS2DObject extends Object3D {
  constructor(element = document.createElement('div')) {
    super();
    this.isCSS2DObject = true;
    this.element = element;
    this.element.style.position = 'absolute';
    this.element.style.userSelect = 'none';
    this.element.setAttribute('draggable', false);
    this.center = new Vector2(.5, .5);
    this.addEventListener('removed', () => this.traverse((object) => object.element?.remove?.()));
  }
}

export class FireBuddyCSS2DRenderer {
  constructor({ element = document.createElement('div') } = {}) {
    const domElement = element;
    domElement.style.overflow = 'hidden';
    this.domElement = domElement;
    let width = 0;
    let height = 0;
    let widthHalf = 0;
    let heightHalf = 0;
    const viewMatrix = new Matrix4();
    const viewProjectionMatrix = new Matrix4();
    const position = new Vector3();

    this.setSize = (nextWidth, nextHeight) => {
      width = nextWidth;
      height = nextHeight;
      widthHalf = width / 2;
      heightHalf = height / 2;
      domElement.style.width = `${width}px`;
      domElement.style.height = `${height}px`;
    };

    const renderObject = (object, camera) => {
      if (object.isCSS2DObject) {
        position.setFromMatrixPosition(object.matrixWorld).applyMatrix4(viewProjectionMatrix);
        const visible = object.visible && position.z >= -1 && position.z <= 1;
        object.element.style.display = visible ? '' : 'none';
        if (visible) {
          object.element.style.transform = `translate(${-100 * object.center.x}%,${-100 * object.center.y}%) translate(${position.x * widthHalf + widthHalf}px,${-position.y * heightHalf + heightHalf}px)`;
          object.element.style.zIndex = String(Math.round(100000 * (1 - position.z)));
          if (object.element.parentNode !== domElement) domElement.appendChild(object.element);
        }
      }
      for (const child of object.children) renderObject(child, camera);
    };

    this.render = (scene, camera) => {
      scene.updateMatrixWorld?.(true);
      camera.updateMatrixWorld?.(true);
      viewMatrix.copy(camera.matrixWorldInverse);
      viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, viewMatrix);
      renderObject(scene, camera);
    };

    this.dispose = () => {
      domElement.querySelectorAll('.fire-buddy-social__bubble').forEach((node) => node.remove());
      domElement.remove();
    };
  }
}
