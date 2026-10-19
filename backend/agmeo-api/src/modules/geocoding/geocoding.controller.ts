import { Controller, Get } from '@nestjs/common';
import { GeocodeReverseQuery, GeocodeSearchQuery } from '@agmeo/contracts';
import { type Out, ZQuery } from '../../core/validation.js';
import { GeocodingService } from './geocoding.service.js';

/** Organization-scoped so only members of an organization can use the geocoder. */
@Controller('orgs/:orgId/geocode')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('search')
  search(@ZQuery(GeocodeSearchQuery) query: Out<typeof GeocodeSearchQuery>) {
    return this.geocoding.search(query);
  }

  @Get('reverse')
  reverse(@ZQuery(GeocodeReverseQuery) query: Out<typeof GeocodeReverseQuery>) {
    return this.geocoding.reverse(query);
  }
}
