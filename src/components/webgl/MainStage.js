import * as THREE from 'three';
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import MinGeometryFinder from "./MinGeometryFinder";
import MinSTLExporter from "./MinSTLExporter";

const DEFAULT_MESH_COLOR = {r: 0.5, g: 0.5, b: 0.5};
const OBJECT_NAME_ALIASES = {
    Torso_Shoulder_L: "Torso_Sholder_L",
    Torso_Shoulder_R: "Torso_Sholder_R"
};
const STL_EXPORT_ORDER = [
    "mesh-stand",
    "mesh-torso",
    "mesh-arm-l",
    "mesh-arm-r",
    "mesh-foot-l",
    "mesh-foot-r",
    "mesh-hand-l",
    "mesh-hand-r",
    "mesh-head",
    "mesh-leg-l",
    "mesh-leg-r",
    "mesh-neck"
];

function setMaterialColor(material, color) {
    if (Array.isArray(material)) {
        for (const entry of material) {
            setMaterialColor(entry, color);
        }

        return;
    }

    if (material?.color?.setRGB) {
        material.color.setRGB(color.r, color.g, color.b);
    }
}

export default class MainStage {
    constructor() {
        if (MainStage._instance) {
            console.warn("Singleton classes can't be instantiated more than once.")
            return MainStage._instance;
        }
        MainStage._instance = this

        this.initialized = false;

        this.camera = null;
        this.scene = null;
        this.renderer = null;
        this.controls = null;
        this.loader = null;
        this.minGeometryFinder = new MinGeometryFinder();
        this.stlExporter = new MinSTLExporter();
        this.cameraTarget = new THREE.Vector3(0, 1, 0);
        this.downloadUrl = null;

        this.animate = this.animate.bind(this);
        this.handleResize = this.handleResize.bind(this);

        this.selected = "Head";
        this.highLightColor = {r: 0.4, g: 0.5, b: 0.6};
        this.normalColor = {...DEFAULT_MESH_COLOR}
        this.standColor = {r: 0.4, g: 0.4, b: 0.4}

        // This group will contain all the meshes but not the floor, the lights etc...
        this.group = new THREE.Group();
        this.group.name = "avatarModel"

        //This keeps track of every mesh on the viewport
        this.loadedMeshes = {
            Torso: {
                name: "default_torso",
                rotation: {x: 0, y: 0, z: 0}
            },
            LegR: {
                name: "default_leg_R",
                rotation: {x: 0, y: 0, z: 0}
            },
            LegL: {
                name: "default_leg_L",
                rotation: {x: 0, y: 0, z: 0}
            },
            Head: {
                name: "default_head",
                rotation: {x: 0, y: 0, z: 0}
            },
            ArmR: {
                name: "default_arm_R",
                rotation: {x: 0, y: 0, z: 0}
            },
            ArmL: {
                name: "default_arm_L",
                rotation: {x: 0, y: 0, z: 0}
            },
            HandR: {
                name: "open_hand_R",
                rotation: {x: 0, y: -1.57, z: 0}
            },
            HandL: {
                name: "open_hand_L",
                rotation: {x: 0, y: 1.57, z: 0}
            },
            FootR: {
                name: "default_foot_R",
                rotation: {x: 0, y: 0, z: 0}
            },
            FootL: {
                name: "default_foot_L",
                rotation: {x: 0, y: 0, z: 0}
            },
            Stand: {
                name: "circle",
                rotation: {x: 0, y: 0, z: 0}
            }
        };

        // List of information on the meshes (attach points, body groups, etc...)
        this.meshStaticInfo = {
            Torso: {
                partCategory: "torso",
                parentAttachment: undefined,
                childAttachment: undefined
            },
            Head: {
                partCategory: "head",
                parentAttachment: "Torso_Neck",
                childAttachment: "Head_Neck"
            },
            ArmR: {
                partCategory: "arm",
                parentAttachment: "Torso_UpperArm_R",
                childAttachment: "ArmR_UpperArm_R"
            },
            ArmL: {
                partCategory: "arm",
                parentAttachment: "Torso_UpperArm_L",
                childAttachment: "ArmL_UpperArm_L"
            },
            HandR: {
                partCategory: "hand",
                parentAttachment: "ArmR_Hand_R",
                childAttachment: "HandR_Hand_R"
            },
            HandL: {
                partCategory: "hand",
                parentAttachment: "ArmL_Hand_L",
                childAttachment: "HandL_Hand_L"
            },
            LegR: {
                partCategory: "leg",
                parentAttachment: "Torso_UpperLeg_R",
                childAttachment: "LegR_UpperLeg_R"
            },
            LegL: {
                partCategory: "leg",
                parentAttachment: "Torso_UpperLeg_L",
                childAttachment: "LegL_UpperLeg_L"
            },
            FootR: {
                partCategory: "foot",
                parentAttachment: "LegR_Foot_R",
                childAttachment: "FootR_Foot_R"
            },
            FootL: {
                partCategory: "foot",
                parentAttachment: "LegL_Foot_L",
                childAttachment: "FootL_Foot_L"
            }
        };

        // List of parent/child relations
        this.childrenList = {
            ArmR: ["HandR"],
            ArmL: ["HandL"],
            Torso: ["ArmR", "ArmL", "Head", "LegR", "LegL"],
            LegR: ["FootR"],
            LegL: ["FootL"]
        };

        this.link = document.createElement("a");
        this.link.style.display = "none";
        document.body.appendChild(this.link);
        window.addEventListener("resize", this.handleResize);

        // Expose global flags
        window.loaded = false;
        window.partLoaded = false;

        // Expose global functions
        window.changeStand = this.changeStand.bind(this);
        window.loadDefaultMeshes = this.loadDefaultMeshes.bind(this);
        window.changeMesh = this.changeMesh.bind(this);
        window.selectedMesh = this.selectedMesh.bind(this);
        window.getRotation = this.getRotation.bind(this);
        window.changeRotation = this.changeRotation.bind(this);
        window.loadPose = this.loadPose.bind(this);
        window.exportToSTL = this.exportToSTL.bind(this);
    }

    // Init Function which will create all the
    // Three.js environment and load the default meshes
    init() {
        this.loader = new GLTFLoader();
        this.scene = new THREE.Scene();
        this.scene.name = "scene"
        this.scene.background = new THREE.Color(80, 80, 80);
        this.scene.fog = new THREE.Fog(0x222222, 1, 20);
        this.scene.add(this.group);

        // this.buildDevHelper();
        this.buildGrid();
        this.buildCamera();
        this.buildRenderer();
        this.buildControls();
        this.buildLights();
        this.buildFloor();

        this.initialized = true;
    }

    normalizeObjectName(name) {
        return OBJECT_NAME_ALIASES[name] || name;
    }

    getSceneObjectByName(name) {
        return this.scene?.getObjectByName(this.normalizeObjectName(name));
    }

    getGroupObjectByName(name) {
        return this.group.getObjectByName(this.normalizeObjectName(name));
    }

    handleResize() {
        if (!this.initialized) {
            return;
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }

    applyColor(root, color) {
        if (!root) {
            return;
        }

        root.traverse(function (child) {
            if (child.isMesh === true) {
                setMaterialColor(child.material, color);
            }
        });
    }

    applyPoseRotation(bone, rotation) {
        if (!(bone instanceof THREE.Bone) || !rotation) {
            return;
        }

        bone.rotation.set(rotation.x, rotation.y, rotation.z);
    }

    applyPoseToObject(root, poseData) {
        if (!poseData) {
            return;
        }

        root.traverse(child => {
            if (child instanceof THREE.Bone) {
                this.applyPoseRotation(child, poseData[child.name]);
            }
        });
    }

    getStandOffset() {
        const footR = this.getSceneObjectByName("FootR");
        const footL = this.getSceneObjectByName("FootL");

        if (!footR || !footL) {
            return null;
        }

        const resultR = this.minGeometryFinder.parse(footR);
        const resultL = this.minGeometryFinder.parse(footL);

        return Math.min(resultR, resultL);
    }

    updateStandPosition() {
        const result = this.getStandOffset();
        const torsoHip = this.getSceneObjectByName("Torso_Hip");

        if (result === null || !torsoHip) {
            return;
        }

        torsoHip.position.y -= result;
    }

    removeAttachedBones(object) {
        if (!object?.children?.length) {
            return;
        }

        for (const child of [...object.children]) {
            if (child instanceof THREE.Bone) {
                object.remove(child);
            }
        }
    }

    resolveMeshChange(category, part, isLeft) {
        switch (category) {
            case "torso":
                return {
                    meshType: "Torso",
                    meshFileName: part.file,
                    rotation: undefined
                };
            case "head":
                return {
                    meshType: "Head",
                    meshFileName: part.file,
                    rotation: part.rotation
                };
            case "hand":
                return {
                    meshType: isLeft ? "HandL" : "HandR",
                    meshFileName: isLeft ? part.file[0] : part.file[1],
                    rotation: isLeft ? part.rotation[0] : part.rotation[1]
                };
            case "arm":
                return {
                    meshType: isLeft ? "ArmL" : "ArmR",
                    meshFileName: isLeft ? part.file[0] : part.file[1],
                    rotation: isLeft ? part.rotation[0] : part.rotation[1]
                };
            case "foot":
                return {
                    meshType: isLeft ? "FootL" : "FootR",
                    meshFileName: isLeft ? part.file[0] : part.file[1],
                    rotation: isLeft ? part.rotation[0] : part.rotation[1]
                };
            case "leg":
                return {
                    meshType: isLeft ? "LegL" : "LegR",
                    meshFileName: isLeft ? part.file[0] : part.file[1],
                    rotation: isLeft ? part.rotation[0] : part.rotation[1]
                };
            default:
                return null;
        }
    }

    getOrderedExportTargets() {
        const targetNames = new Set(STL_EXPORT_ORDER);
        const targets = new Map();

        this.group.traverse(child => {
            if (targetNames.has(child.name) && !targets.has(child.name)) {
                targets.set(child.name, child);
            }
        });

        return STL_EXPORT_ORDER
            .map(meshName => targets.get(meshName))
            .filter(Boolean);
    }

    buildDevHelper() {
        // build Axes
        let axes = new THREE.AxesHelper(10);
        axes.name = "axes";
        this.scene.add(axes);

        // expose scene to DOM
        window.scene = this.scene
        window.THREE = THREE
    }

    buildGrid() {
        // build Grid
        let size = 50;
        let divisions = 60;
        let colorCenterLine = 0x007777;
        let colorGrid = 0x00cccc;
        let grid = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);
        grid.name = "grid";
        this.scene.add(grid);
    }

    buildCamera() {
        this.camera = new THREE.PerspectiveCamera(
            75,
            (window.innerWidth / window.innerHeight),
            0.001,
            1000
        );
        this.camera.name = "camera";
        // Camera position in space (will be controlled by the OrbitControls later on)
        this.camera.position.x = -1;
        this.camera.position.y = 2;
        this.camera.position.z = 2;
    }

    buildRenderer() {
        // Create a renderer with antialias
        this.renderer = new THREE.WebGLRenderer({antialias: true});
        this.renderer.shadowMap.enabled = true;
        // default THREE.PCFShadowMap
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Configure renderer size to fill up the whole window
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        /** The Sky Box
         *
         * CubeTextureLoader axes different from three.js
         * see https://github.com/mrdoob/three.js/issues/12657
         *
         * By convention, likely based on the RenderMan spec from the 1990's cube maps,
         * which are specified by WebGL(and three.js).
         * In a coordinate system in which positive x-axis is to the right when looking to the positive z-axis.
         * In other words, in a left-handed coordinate system.
         * By continuing this convention, preexisting cube maps continued to render correctly.
         *
         * three.js uses a right-handed coordinate system.
         * So environment maps used in three.js appear to have positive x-axis, and negative x-axis swapped.
         * (This is the case for every three.js cube map example.)
         *
         * px = left
         * nx = right
         * py = top
         * ny = bottom
         * pz = front
         * nz = back
         */

        let path = "./img/textures/nightSky/";
        let extension = ".png";
        let urls = [
            path + "px" + extension,
            path + "nx" + extension,
            path + "py" + extension,
            path + "ny" + extension,
            path + "pz" + extension,
            path + "nz" + extension
        ];

        let reflectionCube = new THREE.CubeTextureLoader().load(urls);
        reflectionCube.format = THREE.RGBAFormat;
        reflectionCube.mapping = THREE.CubeRefractionMapping;
        this.scene.background = reflectionCube;
    }

    buildControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(this.cameraTarget);
        //Controlling max and min for ease of use
        this.controls.minDistance = 2;
        this.controls.maxDistance = 7;
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = Math.PI;
        this.controls.enablePan = false;
        this.controls.update();
    }

    buildLights() {
        let pi = Math.PI
        //hemisphere light: like sunlight but without any shadows
        let hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xffffff, pi);
        hemisphereLight.name = "hemisphereLight";
        this.scene.add(hemisphereLight);

        //Create a PointLight and turn on shadows for the light
        let pointLight = new THREE.PointLight(0xcccccc, 2 * pi, 100);
        pointLight.name = "pointLight";
        pointLight.position.set(2, 3, 3);
        pointLight.castShadow = true;
        //Set up shadow properties for the light
        // default width
        pointLight.shadow.mapSize.width = 4096;
        // default height
        pointLight.shadow.mapSize.height = 4096;
        pointLight.decay = 1;
        this.scene.add(pointLight);

        // This light is here to show the details in the back (no shadows)
        let backLight = new THREE.PointLight(0xcccccc, 2 * pi, 100);
        backLight.name = "backLight";
        backLight.position.set(0, 1, -3);
        backLight.penumbra = 2;
        this.scene.add(backLight);
    }

    buildFloor() {
        //Create a plane that receives shadows (but does not cast them)
        let planeGeometry = new THREE.PlaneGeometry(2000, 2000);
        // planeGeometry.rotateX( - Math.PI / 2 );

        let planeMaterial = new THREE.ShadowMaterial();
        planeMaterial.opacity = 0.2;

        let plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.name = "plane";
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = 0;
        plane.receiveShadow = true;
        this.scene.add(plane);
    }

    renderScene() {
        this.renderer.render(this.scene, this.camera);
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderScene();
    }

    clearPosition(item) {
        // This function is used to clear the position of an imported glTF file
        item.position.x = 0;
        item.position.y = 0;
        item.position.z = 0;
    }

    rotateElement(item, clearRotation, rotation) {
        if (clearRotation === true) {
            item.rotation.x = 0;
            item.rotation.y = 0;
            item.rotation.z = 0;
        } else {
            item.rotation.x = rotation.x;
            item.rotation.y = rotation.y;
            item.rotation.z = rotation.z;
        }
    }

    placeMesh(
        meshFileName,
        partCategory,
        meshType,
        parentAttachment,
        childAttachment,
        rotation,
        isFirstLoad,
        isHighLighted,
        bones,
        poseData
    ) {
        // partCategory : {arm, head, hand, torso, leg, foot}
        // meshType : {ArmR, ArmL, Head, HandR, HandL, LegR, LegL, FootR, FootL, Torso}
        this.loader.load(
            "./models/" + partCategory + "/" + meshFileName + ".glb",
            glTF => {
                let loadedContentRoot = glTF.scene.children[0];
                loadedContentRoot.traverse(function (child) {
                    if (child.isMesh === true) {
                        // Gives a fixed name to the mesh and same gray color
                        child.name = "mesh-" + meshType.toLowerCase();
                        child.castShadow = true;
                        setMaterialColor(child.material, DEFAULT_MESH_COLOR);
                    }
                });

                // Fix naming errors in modeling (errors in glb).
                loadedContentRoot.name = meshType;

                // group is one element with all the meshes and bones of the character
                this.group.add(loadedContentRoot);
                this.scene.updateMatrixWorld(true);

                // Updates the loadedMeshes variable (used for replacing children)changeColor
                this.loadedMeshes[meshType].name = meshFileName;
                this.loadedMeshes[meshType].rotation = rotation;

                if (meshType === "Head" && isFirstLoad) {
                    this.changeColor("Head", this.highLightColor);
                }

                if (isHighLighted) {
                    this.changeColor(meshType, this.highLightColor);
                }

                // Putting the new mesh in the pose configuration if any pose as been selected
                this.applyPoseToObject(loadedContentRoot, poseData);

                if (
                    typeof parentAttachment !== "undefined" &&
                    typeof childAttachment !== "undefined"
                ) {
                    let targetBone = this.getSceneObjectByName(parentAttachment);
                    let object = this.getSceneObjectByName(childAttachment);

                    if (targetBone && object) {
                        this.clearPosition(object);
                        this.rotateElement(object, true);
                        this.rotateElement(object, false, rotation);
                        targetBone.add(object);
                    }
                }

                this.scene.updateMatrixWorld(true);

                //Going to look for all children of current mesh
                let children = this.childrenList[meshType];
                if (children) {
                    for (const child of children) {
                        this.refreshMesh(child, isFirstLoad, bones, poseData);
                    }
                }

                if (meshType === "FootR") {
                    if (this.getSceneObjectByName("FootL_Toes_L")) {
                        this.scene.updateMatrixWorld(true);
                        this.placeStand();
                    }
                } else if (meshType === "FootL") {
                    if (this.getSceneObjectByName("FootR_Toes_R")) {
                        this.scene.updateMatrixWorld(true);
                        this.placeStand();
                    }
                }
                window.partLoaded = true;
            },
            null,
            function (error) {
                console.log(error);
            }
        );
    }

    refreshMesh(meshType, isFirstLoad, bones, poseData) {
        this.group.remove(this.getGroupObjectByName(meshType));
        this.placeMesh(
            this.loadedMeshes[meshType].name,
            this.meshStaticInfo[meshType].partCategory,
            meshType,
            this.meshStaticInfo[meshType].parentAttachment,
            this.meshStaticInfo[meshType].childAttachment,
            this.loadedMeshes[meshType].rotation,
            isFirstLoad,
            false,
            bones,
            poseData
        );
    }

    loadStand(stand) {
        let standColor = this.standColor;
        this.loader.load(
            "./models/stand/" + stand + ".glb",
            glTF => {
                let loadedContentRoot = glTF.scene.children[0];

                loadedContentRoot.traverse(function (child) {
                    if (child.isMesh === true) {
                        child.name = "mesh-stand";
                        child.castShadow = true;
                        child.receiveShadow = true;
                        setMaterialColor(child.material, standColor);
                    }
                });

                //Default color to all the meshes
                if (loadedContentRoot.material) {
                    setMaterialColor(loadedContentRoot.material, standColor);
                }

                this.group.add(loadedContentRoot);
                this.updateStandPosition();
                window.loaded = true;
            },
            null,
            function (error) {
                console.log(error);
            }
        );
    }

    placeStand() {
        if (this.getSceneObjectByName("mesh-stand")) {
            this.updateStandPosition();
        } else {
            this.loadStand("circle");
        }
    }

    changeStand(stand) {
        const currentStand = this.getSceneObjectByName("mesh-stand");

        if (currentStand) {
            this.group.remove(currentStand);
            this.loadStand(stand);
        }
    };

    loadDefaultMeshes(bones, poseData) {
        this.placeMesh(
            this.loadedMeshes["Torso"].name,
            this.meshStaticInfo["Torso"].partCategory,
            "Torso",
            undefined,
            undefined,
            undefined,
            true,
            false,
            bones,
            poseData
        );
    };

    changeMesh(category, part, isLeft, bones, poseData) {
        window.partLoaded = false;
        const nextMesh = this.resolveMeshChange(category, part, isLeft);
        const meshType = nextMesh?.meshType;
        const meshFileName = nextMesh?.meshFileName;
        const rotation = nextMesh?.rotation;

        if (meshType) {
            let parentAttachmentName = this.meshStaticInfo[meshType].parentAttachment;
            let childAttachmentName = this.meshStaticInfo[meshType].childAttachment;
            let currentMesh = this.getGroupObjectByName(meshType);
            let parentAttachmentMesh =
                meshType === "Torso"
                    ? this.getSceneObjectByName("Torso_Hip")
                    : this.getGroupObjectByName(parentAttachmentName);

            if (currentMesh) {
                this.group.remove(currentMesh);
                this.removeAttachedBones(parentAttachmentMesh);
                this.placeMesh(
                    meshFileName,
                    category,
                    meshType,
                    parentAttachmentName,
                    childAttachmentName,
                    rotation,
                    false,
                    true,
                    bones,
                    poseData
                );
            }
        }
        return true;
    };

    changeColor(item, chosenColor) {
        let mesh = item === "pose" ? this.group : this.getSceneObjectByName(item);
        this.applyColor(mesh, chosenColor);
    }

    selectedMesh(meshType) {
        if (this.selected === "mesh-stand") {
            // DO NOT remove this line unless three.js coloring bug is fixed
            this.changeColor(this.selected, this.normalColor);
            this.changeColor(this.selected, this.standColor);
        } else {
            this.changeColor(this.selected, this.normalColor);
        }
        this.changeColor(meshType, this.highLightColor);
        this.selected = meshType;
    };

    getRotation(bone_name) {
        let bone = this.getSceneObjectByName(bone_name);
        if (bone instanceof THREE.Bone) {
            return {x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z};
        }
    };

    changeRotation(bone_name, value, axis) {
        let bone = this.getSceneObjectByName(bone_name);
        if (bone instanceof THREE.Bone) {
            switch (axis) {
                case "x":
                    bone.rotation.x = value;
                    break;
                case "y":
                    bone.rotation.y = value;
                    break;
                case "z":
                    bone.rotation.z = value;
                    break;
                default:
            }
        }
    };

    loadPose(poseData, bones) {
        let shouldPlaceStand = false;

        for (const boneElem of bones) {
            let bone = boneElem.bone;
            const rotation = poseData[bone];
            const targetBone = this.getSceneObjectByName(bone);

            this.applyPoseRotation(targetBone, rotation);

            if (bone === "LegL_Foot_L" || bone === "LegR_Foot_R") {
                shouldPlaceStand = true;
            }
        }

        this.scene.updateMatrixWorld(true);

        if (shouldPlaceStand) {
            this.placeStand();
        }
    };

    save(blob, filename) {
        if (this.downloadUrl) {
            URL.revokeObjectURL(this.downloadUrl);
        }

        this.downloadUrl = URL.createObjectURL(blob);
        this.link.href = this.downloadUrl;
        this.link.download = filename || "untitled.json";
        this.link.click();
    }

    saveArrayBuffer(buffer, filename) {
        this.save(new Blob([buffer], {type: "application/octet-stream"}), filename);
    }

    saveString(text, filename) {
        this.save(new Blob([text], {type: "text/plain"}), filename);
    }

    exportToSTL(name) {
        if (name) {
            this.saveString(this.stlExporter.parse(this.group), name + ".stl");
        } else {
            return this.getOrderedExportTargets().map(mesh => this.stlExporter.parse(mesh));
        }
    };
}
