export type MeetingFloor = 1 | 2;

export interface MeetingVenueRecord {
  caseId: string;
  floor: MeetingFloor;
}

export function chooseMeetingVenue(
  caseId: string,
  upperFloorAvailable: boolean,
  previous?: MeetingVenueRecord,
): MeetingVenueRecord {
  if (previous?.caseId === caseId)
    return {
      caseId,
      floor: upperFloorAvailable ? previous.floor : 1,
    };

  const floor: MeetingFloor =
    upperFloorAvailable && previous?.floor === 1 ? 2 : 1;
  return { caseId, floor };
}
