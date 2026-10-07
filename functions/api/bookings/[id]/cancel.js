import { cancelBooking } from '../../../../lib/cancelBooking.js';

export const onRequestPost = context => cancelBooking(context, 'confirmed');
