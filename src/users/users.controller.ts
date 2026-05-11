import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateGlobalManagerDto } from './dto/create-global-manager.dto';
import { CreateInstitutionUserDto } from './dto/create-institution-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query()
    query: {
      institutionId?: string;
      role?: string;
      includeInactive?: string;
    },
  ) {
    return this.usersService.findAll(user, query);
  }

  @Post('global-manager')
  createGlobalManager(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGlobalManagerDto,
  ) {
    return this.usersService.createGlobalManager(user, dto);
  }

  @Post('institution-user')
  createInstitutionUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInstitutionUserDto,
  ) {
    return this.usersService.createInstitutionUser(user, dto);
  }

  @Patch(':id')
  updateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(user, id, dto);
  }

  @Delete(':id')
  deactivateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.usersService.deactivateUser(user, id);
  }
}
