import { IdentityStorage, type IIdentityStorage } from "./identity";
import { SchedulingStorage, type ISchedulingStorage } from "./scheduling";
import { AvailabilityStorage, type IAvailabilityStorage } from "./availability";
import { NotificationsStorage, type INotificationsStorage } from "./notifications";
import { SopStorage, type ISopStorage } from "./sop";
import { GtdStorage, type IGtdStorage } from "./gtd";
import { MiscStorage, type IMiscStorage } from "./misc";

export type {
  IIdentityStorage,
  ISchedulingStorage,
  IAvailabilityStorage,
  INotificationsStorage,
  ISopStorage,
  IGtdStorage,
  IMiscStorage,
};

export type IStorage =
  IIdentityStorage &
  ISchedulingStorage &
  IAvailabilityStorage &
  INotificationsStorage &
  ISopStorage &
  IGtdStorage &
  IMiscStorage;

function applyMixins(derivedCtor: any, constructors: any[]) {
  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      if (name !== 'constructor') {
        Object.defineProperty(
          derivedCtor.prototype,
          name,
          Object.getOwnPropertyDescriptor(baseCtor.prototype, name) || Object.create(null)
        );
      }
    });
  });
}

class DatabaseStorage {}

interface DatabaseStorage extends
  IIdentityStorage,
  ISchedulingStorage,
  IAvailabilityStorage,
  INotificationsStorage,
  ISopStorage,
  IGtdStorage,
  IMiscStorage {}

applyMixins(DatabaseStorage, [
  IdentityStorage,
  SchedulingStorage,
  AvailabilityStorage,
  NotificationsStorage,
  SopStorage,
  GtdStorage,
  MiscStorage,
]);

export { DatabaseStorage };
export const storage: IStorage = new DatabaseStorage();
