/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { IRequest, IResponse, IComponentHandle, IComponentLoadable } from "@fluidframework/component-core-interfaces";
import { ComponentHandle, ComponentRuntime } from "@fluidframework/component-runtime";
import { SharedMap, ISharedMap } from "@fluidframework/map";
import { IComponentContext, IComponentFactory } from "@fluidframework/runtime-definitions";
import { IComponentRuntime, IChannelFactory } from "@fluidframework/component-runtime-definitions";
import { ITestFluidComponent } from "./interfaces";

/**
 * A test component that will create a shared object for each key-value pair in the factoryEntries passed to load.
 * The shared objects can be retrieved by passing the key of the entry to getSharedObject.
 * It exposes the IComponentContext and IComponentRuntime.
 */
export class TestFluidComponent implements ITestFluidComponent, IComponentLoadable {
    public static async load(
        runtime: IComponentRuntime,
        context: IComponentContext,
        factoryEntries: Map<string, IChannelFactory>) {
        const component = new TestFluidComponent(runtime, context, factoryEntries);
        await component.initialize();

        return component;
    }

    public get ITestFluidComponent() {
        return this;
    }

    public get IComponentLoadable() {
        return this;
    }

    public get handle(): IComponentHandle<this> { return this.innerHandle; }

    public url: string;
    public root!: ISharedMap;
    private readonly innerHandle: IComponentHandle<this>;

    /**
     * Creates a new TestFluidComponent.
     * @param runtime - The component runtime.
     * @param context - The componet context.
     * @param factoryEntries - A list of id to IChannelFactory mapping. For each item in the list,
     * a shared object is created which can be retrieved by calling getSharedObject() with the id;
     */
    constructor(
        public readonly runtime: IComponentRuntime,
        public readonly context: IComponentContext,
        private readonly factoryEntriesMap: Map<string, IChannelFactory>,
    ) {
        this.url = context.id;
        this.innerHandle = new ComponentHandle(this, "", runtime.IComponentHandleContext);
    }

    /**
     * Retrieves a shared object with the given id.
     * @param id - The id of the shared object to retrieve.
     */
    public async getSharedObject<T = any>(id: string): Promise<T> {
        if (this.factoryEntriesMap === undefined) {
            throw new Error("Shared objects were not provided during creation.");
        }

        for (const key of this.factoryEntriesMap.keys()) {
            if (key === id) {
                const handle = this.root.get<IComponentHandle>(id);
                return handle?.get() as unknown as T;
            }
        }

        throw new Error(`Shared object with id ${id} not found.`);
    }

    public async request(request: IRequest): Promise<IResponse> {
        return {
            mimeType: "fluid/component",
            status: 200,
            value: this,
        };
    }

    private async initialize() {
        if (!this.runtime.existing) {
            this.root = SharedMap.create(this.runtime, "root");

            this.factoryEntriesMap.forEach((sharedObjectFactory: IChannelFactory, key: string) => {
                const sharedObject = this.runtime.createChannel(key, sharedObjectFactory.type);
                this.root.set(key, sharedObject.handle);
            });

            this.root.bindToContext();
        }

        this.root = await this.runtime.getChannel("root") as ISharedMap;
    }
}

/**
 * Creates a factory for a TestFluidComponent with the given object factory entries. It creates a component runtime
 * with the object factories in the entry list. All the entries with an id other than undefined are passed to the
 * component so that it can create a shared object for each.
 *
 * For example, the following will create a component that creates and loads a SharedString and SharedDirectory. It
 * will add SparseMatrix to the component runtime's factory so that it can be created later.
 *      new TestFluidComponentFactory([
 *          [ "sharedString", SharedString.getFactory() ],
 *          [ "sharedDirectory", SharedDirectory.getFactory() ],
*          [ undefined, SparseMatrix.getFactory() ],
 *      ]);
 *
 * The SharedString and SharedDirectory can be retrieved via getSharedObject() on the TestFluidComponent as follows:
 *      sharedString = testFluidComponent.getSharedObject<SharedString>("sharedString");
 *      sharedDir = testFluidComponent.getSharedObject<SharedDirectory>("sharedDirectory");
 */
export class TestFluidComponentFactory implements IComponentFactory {
    public static readonly type = "TestFluidComponentFactory";
    public readonly type = TestFluidComponentFactory.type;

    public get IComponentFactory() { return this; }

    /**
     * Creates a new TestFluidComponentFactory.
     * @param factoryEntries - A list of id to IChannelFactory mapping. It creates a component runtime with each
     * IChannelFactory. Entries with string ids are passed to the component so that it can create a shared object
     * for it.
     */
    constructor(private readonly factoryEntries: Iterable<[string | undefined, IChannelFactory]>) { }

    public instantiateComponent(context: IComponentContext): void {
        const dataTypes = new Map<string, IChannelFactory>();

        // Add SharedMap's factory which will be used to create the root map.
        const sharedMapFactory = SharedMap.getFactory();
        dataTypes.set(sharedMapFactory.type, sharedMapFactory);

        // Add the object factories to the list to be sent to component runtime.
        for (const entry of this.factoryEntries) {
            const factory = entry[1];
            dataTypes.set(factory.type, factory);
        }

        const runtime = ComponentRuntime.load(
            context,
            dataTypes,
        );

        // Create a map from the factory entries with entries that don't have the id as undefined. This will be
        // passed to the component.
        const factoryEntriesMapForComponent = new Map<string, IChannelFactory>();
        for (const entry of this.factoryEntries) {
            const id = entry[0];
            if (id !== undefined) {
                factoryEntriesMapForComponent.set(id, entry[1]);
            }
        }

        const testFluidComponentP = TestFluidComponent.load(runtime, context, factoryEntriesMapForComponent);
        runtime.registerRequestHandler(async (request: IRequest) => {
            const testFluidComponent = await testFluidComponentP;
            return testFluidComponent.request(request);
        });
    }
}