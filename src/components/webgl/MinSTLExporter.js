import * as THREE from 'three';

const EXPORT_SCALE = 35;

const vertexA = new THREE.Vector3();
const vertexB = new THREE.Vector3();
const vertexC = new THREE.Vector3();
const cb = new THREE.Vector3();
const ab = new THREE.Vector3();
const normal = new THREE.Vector3();

function getAvatarName() {
    const rawAvatarName = typeof window !== 'undefined' && typeof window.avatarName === 'string'
        ? window.avatarName
        : '';

    return rawAvatarName.trim().toLowerCase().replace(/\s+/g, '-') || 'exported';
}

function writeVertex(output, vertex) {
    output.push(
        '\t\t\tvertex ',
        vertex.x * EXPORT_SCALE,
        ' ',
        vertex.y * EXPORT_SCALE,
        ' ',
        vertex.z * EXPORT_SCALE,
        '\n'
    );
}

function writeFace(output, mesh, positionAttribute, a, b, c) {
    vertexA.fromBufferAttribute(positionAttribute, a);
    vertexB.fromBufferAttribute(positionAttribute, b);
    vertexC.fromBufferAttribute(positionAttribute, c);

    if (mesh.isSkinnedMesh === true) {
        mesh.applyBoneTransform(a, vertexA);
        mesh.applyBoneTransform(b, vertexB);
        mesh.applyBoneTransform(c, vertexC);
    }

    vertexA.applyMatrix4(mesh.matrixWorld);
    vertexB.applyMatrix4(mesh.matrixWorld);
    vertexC.applyMatrix4(mesh.matrixWorld);

    // Normals need to be derived from the final posed triangle in world space.
    cb.subVectors(vertexC, vertexB);
    ab.subVectors(vertexA, vertexB);
    normal.copy(cb.cross(ab).normalize());

    output.push(
        '\tfacet normal ',
        normal.x,
        ' ',
        normal.y,
        ' ',
        normal.z,
        '\n',
        '\t\touter loop\n'
    );

    writeVertex(output, vertexA);
    writeVertex(output, vertexB);
    writeVertex(output, vertexC);

    output.push('\t\tendloop\n', '\tendfacet\n');
}

export default class MinSTLExporter {

    parse(scene) {
        const avatarName = getAvatarName();
        const output = ['solid ', avatarName, '\n'];

        scene.updateMatrixWorld(true);

        scene.traverse(function (mesh) {
            if (mesh.isMesh !== true) {
                return;
            }

            const bufferGeometry = mesh.geometry;
            const bufferPositions = bufferGeometry?.getAttribute?.('position');

            if (!bufferPositions) {
                return;
            }

            const bufferIndices = bufferGeometry.getIndex();

            if (bufferIndices) {
                for (let i = 0, len = bufferIndices.count - (bufferIndices.count % 3); i < len; i += 3) {
                    writeFace(
                        output,
                        mesh,
                        bufferPositions,
                        bufferIndices.getX(i),
                        bufferIndices.getX(i + 1),
                        bufferIndices.getX(i + 2)
                    );
                }

                return;
            }

            for (let i = 0, len = bufferPositions.count - (bufferPositions.count % 3); i < len; i += 3) {
                writeFace(output, mesh, bufferPositions, i, i + 1, i + 2);
            }
        });

        output.push('endsolid ', avatarName, '\n');

        return output.join('');
    }
}
